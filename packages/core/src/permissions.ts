// The core's own permission policy: which requests it answers without asking the user. A pure function of the request
// and plain data, so it can be tested alone. Extensions' policies run after it (core.ts); its denials stand.
import { resolve } from 'node:path'
import type { PermissionRequest, PermissionVerdict } from '@kothar/extension-api'
import { editableOf, placeOf, refusedEditWhy, type FolderPlace } from './folder-modes.ts'
import { realPath } from './machine.ts'
import { isReadOnlyCommand, isSecret, mentionsSecret, searchReachesSecret, secretPathsOf } from './read-only.ts'
import { sshHostsOf, switchedOn, type PermissionSwitch, type PermissionSwitches, type SshHost } from './shared.ts'
import { ASKS_FIRST, sshHostOf, trustsSshHosts } from './ssh-hosts.ts'
import { within } from './util.ts'

export const OUTSIDE_EDIT_ADVICE =
  "Work there, or ask the user to add the folder in the chat's Context panel and set its mode to Edit in place."
export { ASKS_FIRST }
// The rule of an answer for a command that reaches only allowed SSH hosts.
export const SSH_HOSTS_RULE = 'Allowed SSH hosts'

export type PermissionContext = {
  // Where the session runs: relative paths start here.
  cwd: string
  // The chat's work folder: edits inside it never ask.
  workDir: string
  // True while the session runs in the sandbox (the edit anywhere switch is off and the machine can sandbox).
  sandboxed: boolean
  // The chat's switch layers, nearest first (the chat, its parents, then settings).
  switches: PermissionSwitches[]
  home: string
  garage: string
  // The turn's attached folders: each one's mode, or a git folder's checkout. Edits in a folder set to Edit in place
  // are answered like the work folder's; edits in one set to Read only are refused, sandboxed or not.
  folders?: FolderPlace[]
  // The turn is read only (an extension's TurnOptions): edits and commands that may change anything are refused, with
  // reason (or a default) as the agent's message. Reads still follow the switches.
  readOnly?: { reason?: string }
}

export const READ_ONLY_REASON = 'This turn is read only: it may read and search, but not edit files or run commands that change anything.'

// A verdict and the rule that gave it, as the Inspector's Activity shows it.
export type RuledVerdict = PermissionVerdict & { rule: string }

// A verdict answers the request; undefined leaves it to extensions and then the user.
export const verdictOf = (request: PermissionRequest, context: PermissionContext): PermissionVerdict | undefined => {
  const ruled = decide(request, context)
  if (!ruled) return undefined
  const { rule: _rule, ...verdict } = ruled
  return verdict
}

// The switches as the Context panel names them.
const SWITCH_NAMES: Record<PermissionSwitch, string> = {
  allowAll: 'Allow all',
  editAnywhere: 'Allow edits outside the work folder',
  autoRead: 'Read anywhere without asking',
  autoFetch: 'Fetch web pages without asking',
  autoRunCommands: 'Run commands without asking',
  autoNetworkCommands: 'Run network commands without asking',
  autoEnvCommands: 'Let commands use .env files without asking',
}
// The rule of an Allow all answer: it stands over extensions' policies too.
export const ALLOW_ALL_RULE = 'Switch: Allow all'
const switchRule = (...names: PermissionSwitch[]) => `Switch: ${names.map((name) => SWITCH_NAMES[name] ?? name).join(' + ')}`

// verdictOf, with the rule behind each answer.
export const decide = (request: PermissionRequest, context: PermissionContext): RuledVerdict | undefined => {
  const { cwd, workDir, sandboxed, switches, home, garage, folders = [], readOnly } = context
  if (readOnly) {
    const refused = { allow: false, message: readOnly.reason?.trim() || READ_ONLY_REASON, rule: 'Read-only turn' }
    if (request.kind === 'edit') return refused
    // Whether the command only reads is asked without the login folders, so reading one still asks below rather than
    // being refused as a change.
    if (request.kind === 'shell' && (request.command === undefined || !isReadOnlyCommand(request.command, { cwd, home, secrets: [] }))) {
      return refused
    }
  }
  // Allow all approves everything, logins and keys included. Only a folder the user set to Read only stays read only.
  if (switchedOn('allowAll', ...switches)) {
    const target = request.kind === 'edit' && request.path !== undefined ? realPath(resolve(cwd, request.path)) : undefined
    const place = target === undefined || within(target, workDir) ? undefined : placeOf(target, folders)
    if (target === undefined || place?.mode !== 'readOnly') return { allow: true, rule: ALLOW_ALL_RULE }
  }
  if (request.kind === 'edit' && request.path !== undefined) {
    // Edits in the work folder need no asking; outside it the sandbox would fail them anyway.
    const target = realPath(resolve(cwd, request.path))
    if (within(target, workDir)) return { allow: true, rule: 'Kothar core: edits in the work folder' }
    // A folder edited in place is like the work folder, but logins, keys and .env files in it still ask.
    if (editableOf(folders).some((folder) => within(target, realPath(folder)))) {
      return isSecret(target, { cwd, home, secrets: secretPathsOf(home, garage) }) ? undefined : { allow: true, rule: 'Folder mode: Edit in place' }
    }
    // Unsandboxed, an edit elsewhere asks, but a folder the user set to Read only stays read only.
    const place = placeOf(target, folders)
    if (!sandboxed && (!place || place.mode === 'checkout')) return undefined
    const why = place?.mode === 'readOnly' ? 'Folder mode: Read only' : 'Kothar core: the sandbox keeps edits in the work folder'
    return { allow: false, message: refusedEditWhy(target, workDir, folders, OUTSIDE_EDIT_ADVICE), rule: why }
  }
  const on = (name: PermissionSwitch) => switchedOn(name, ...switches)
  // Fetching writes nothing, so it needs no sandbox.
  if (request.kind === 'fetch') return on('autoFetch') ? { allow: true, rule: switchRule('autoFetch') } : undefined
  // Reading writes nothing either, but logins and keys still ask.
  const reading = { cwd, home, secrets: secretPathsOf(home, garage) }
  // .env files are let through only where commands run without asking: sandboxed, both switches on.
  const envFiles = sandboxed && on('autoRunCommands') && on('autoEnvCommands')
  const sandboxedReading = { ...reading, envFiles }
  if (request.kind === 'read' || request.kind === 'search') {
    if (!on('autoRead')) return
    if (request.kind === 'read') {
      return request.path !== undefined && !isSecret(request.path, sandboxedReading) ? { allow: true, rule: switchRule('autoRead') } : undefined
    }
    return searchReachesSecret(request.path ?? cwd, sandboxedReading) ? undefined : { allow: true, rule: switchRule('autoRead') }
  }
  if (request.kind !== 'shell' || request.command === undefined) return
  if (on('autoRead') && isReadOnlyCommand(request.command, reading)) return { allow: true, rule: `${switchRule('autoRead')} (a command that only reads)` }
  if (!sandboxed || !on('autoRunCommands')) return
  // ssh, scp, sftp and rsync to allowed hosts, with their listed keys, run even while network commands ask.
  if (trustsSshHosts(request.command, sshHostsOf(...switches), sandboxedReading)) return { allow: true, rule: SSH_HOSTS_RULE }
  if (!on('autoNetworkCommands') && ASKS_FIRST.test(request.command)) return
  if (mentionsSecret(request.command, sandboxedReading)) return
  return { allow: true, rule: envFiles && /\.env\b/.test(request.command) ? switchRule('autoRunCommands', 'autoEnvCommands') : switchRule('autoRunCommands') }
}

// The SSH server a shell request could be trusted by, for the card's "Always allow" (sshHostOf): only where Allowed SSH
// hosts count at all (a sandboxed chat running commands without asking, in a turn that isn't read only) and only when
// the command isn't already approved by its hosts.
export const trustableSshHost = (request: PermissionRequest, context: PermissionContext): SshHost | undefined => {
  const { cwd, sandboxed, switches, home, garage, readOnly } = context
  if (request.kind !== 'shell' || request.command === undefined || readOnly || !sandboxed) return
  if (!switchedOn('autoRunCommands', ...switches) || switchedOn('allowAll', ...switches)) return
  const reading = { cwd, home, secrets: secretPathsOf(home, garage), envFiles: switchedOn('autoEnvCommands', ...switches) }
  if (trustsSshHosts(request.command, sshHostsOf(...switches), reading)) return
  return sshHostOf(request.command, reading)
}
