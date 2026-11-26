// Allowed SSH hosts: whether a shell command's ssh, scp, sftp and rsync all reach servers the user trusts, with only
// the keys listed for them, so it may run without asking even while network commands ask (permissions.ts). It reads the
// command with read-only.ts's shell parser, expanding plain variables set earlier in the same command (K=~/.ssh/k,
// for f in a b; do ...). Everything else in the command is held to the usual rule: no other network command and no
// login or key named. Anything it can't follow, it doesn't trust, and the command asks as before.
import { resolve } from 'node:path'
import { realPath } from './machine.ts'
import { commandsOf, expandHome, isSecret, mentionsSecret, searchReachesSecret, tokenize, type ReadContext, type Word } from './read-only.ts'
import { ASK_FIRST_COMMANDS, type SshHost } from './shared.ts'

// Commands that publish or reach the network, wherever they appear in a command's text.
export const ASKS_FIRST = new RegExp(`\\b(?:${ASK_FIRST_COMMANDS.map((c) => c.replaceAll(' ', '\\s+')).join('|')})\\b`)

export const MAX_SSH_HOSTS = 50
const HOST_NAME = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/
const USER_NAME = /^[A-Za-z0-9._-]+$/
const HOST_PATTERN = /^(?:[A-Za-z0-9._-]+@)?(?:\*\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/

// A list from the UI, checked: each host as host, user@host or *.example.com, each key a full path.
export const checkSshHosts = (raw: unknown): SshHost[] => {
  if (!Array.isArray(raw)) throw new Error('The allowed SSH hosts must be a list')
  if (raw.length > MAX_SSH_HOSTS) throw new Error(`At most ${MAX_SSH_HOSTS} SSH hosts`)
  const hosts: SshHost[] = []
  for (const entry of raw as { host?: unknown; key?: unknown }[]) {
    const host = String(entry?.host ?? '').trim()
    if (!HOST_PATTERN.test(host)) {
      throw new Error(`"${host}" isn't a host: write it as host.example.com, user@host.example.com or *.example.com`)
    }
    const key = typeof entry?.key === 'string' ? entry.key.trim() : ''
    if (key && (!/^(?:~\/|\/)./.test(key) || /[\0\n]/.test(key))) {
      throw new Error(`"${key}" isn't a key file: write its full path, like ~/.ssh/id_ed25519`)
    }
    if (!hosts.some((h) => h.host === host && (h.key ?? '') === key)) hosts.push({ host, ...(key && { key }) })
  }
  return hosts
}

type Target = { host: string; user?: string }

const targetOf = (spec: string, user?: string): Target | undefined => {
  const at = spec.lastIndexOf('@')
  const name = at >= 0 ? spec.slice(0, at) : user
  const host = spec.slice(at + 1)
  if (!HOST_NAME.test(host) || (name !== undefined && !USER_NAME.test(name))) return
  return { host, ...(name !== undefined && { user: name }) }
}

// scheme://[user@]host[:port][/path]
const uriTarget = (value: string, scheme: string, user?: string) => {
  const rest = value.slice(scheme.length + 3)
  const authority = rest.split('/')[0]!.replace(/:\d+$/, '')
  return targetOf(authority, user)
}

const hostMatches = (pattern: string, host: string) => {
  const p = pattern.toLowerCase()
  const h = host.toLowerCase()
  return p.startsWith('*.') ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : p === h
}

// A key's real path, for comparing a typed key with a listed one.
const keyPath = (path: string, cwd: string, home: string) => realPath(resolve(cwd, expandHome(path, home)))

// True if an entry covers the target with these keys (real paths): without -i, any entry for the host does; with one,
// the entry must list that key.
const allows = (hosts: SshHost[], target: Target, keys: string[], home: string) =>
  hosts.some((entry) => {
    const at = entry.host.lastIndexOf('@')
    if (!hostMatches(entry.host.slice(at + 1), target.host)) return false
    if (at >= 0 && target.user !== entry.host.slice(0, at)) return false
    if (!keys.length) return true
    return entry.key !== undefined && keys.every((key) => key === keyPath(entry.key!, home, home))
  })

// --- Options ---

type Option = { flag: string; value?: string; at: number }
type Parsed = { options: Option[]; operands: { value: string; at: number }[] }

// Short options, clustered or not, anywhere among the operands (as OpenSSH and GNU getopt read them), up to --. Any
// option not listed is unknown, and the command isn't trusted.
const parseShort = (args: string[], plain: string, valued: string): Parsed | undefined => {
  const options: Option[] = []
  const operands: Parsed['operands'] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      operands.push(...args.slice(i + 1).map((value, j) => ({ value, at: i + 1 + j })))
      break
    }
    if (!arg.startsWith('-') || arg === '-') {
      operands.push({ value: arg, at: i })
      continue
    }
    for (let j = 1; j < arg.length; j++) {
      const flag = arg[j]!
      if (plain.includes(flag)) {
        options.push({ flag, at: i })
        continue
      }
      if (!valued.includes(flag)) return
      const inline = arg.slice(j + 1)
      if (inline) options.push({ flag, value: inline, at: i })
      else {
        if (i + 1 >= args.length) return
        options.push({ flag, value: args[++i]!, at: i })
      }
      break
    }
  }
  return { options, operands }
}

// -o settings that only tune the connection. The rest (ProxyCommand, LocalCommand, IdentityFile...) could run a program
// or read another file, so they aren't trusted.
const SAFE_SETTINGS = new Set([
  'addressfamily', 'batchmode', 'compression', 'connectionattempts', 'connecttimeout', 'identitiesonly', 'loglevel',
  'port', 'requesttty', 'serveralivecountmax', 'serveraliveinterval', 'stricthostkeychecking', 'tcpkeepalive',
])

// What ssh, scp and sftp options share: -i keys, -F (only ~/.ssh/config) and -o (only SAFE_SETTINGS).
const sshOptions = (options: Option[], cwd: string, home: string) => {
  const keys: string[] = []
  const exempt = new Set<number>()
  for (const { flag, value, at } of options) {
    if (flag === 'i') {
      keys.push(keyPath(value!, cwd, home))
      exempt.add(at)
    }
    if (flag === 'F') {
      if (keyPath(value!, cwd, home) !== keyPath('~/.ssh/config', home, home)) return
      exempt.add(at)
    }
    if (flag === 'o' && !SAFE_SETTINGS.has(/^[A-Za-z]+/.exec(value!)?.[0]?.toLowerCase() ?? '')) return
  }
  return { keys, exempt }
}

// A local file or folder a copy reads or writes: never a login or key, nor a folder holding one (scp -r ~), nor a glob.
const safeLocal = (path: string, cwd: string, context: ReadContext) =>
  !/[*?[]/.test(path) && !searchReachesSecret(path, { ...context, cwd })

// [user@]host:path, as scp and rsync tell a remote path from a local one: a colon before any slash.
const remoteOf = (operand: string) => {
  const colon = operand.indexOf(':')
  const slash = operand.indexOf('/')
  return colon > 0 && (slash < 0 || colon < slash) ? operand.slice(0, colon) : undefined
}

type Verdict = { exempt: Set<number> } | undefined

const ssh = (args: string[], hosts: SshHost[], cwd: string, context: ReadContext): Verdict => {
  const parsed = parseShort(args, '46AaCfGgKkNnqsTtVvXxYy', 'BbceFilmopQ')
  const shared = parsed && sshOptions(parsed.options, cwd, context.home)
  const destination = parsed?.operands[0]?.value
  if (!shared || destination === undefined) return
  const user = parsed.options.findLast((o) => o.flag === 'l')?.value
  const target = destination.startsWith('ssh://') ? uriTarget(destination, 'ssh', user) : targetOf(destination, user)
  return target && allows(hosts, target, shared.keys, context.home) ? { exempt: shared.exempt } : undefined
}

const scp = (args: string[], hosts: SshHost[], cwd: string, context: ReadContext): Verdict => {
  // -l is a bandwidth limit here, not a user.
  const parsed = parseShort(args, '346ABCOpqRrTv', 'cFilPo')
  const shared = parsed && sshOptions(parsed.options, cwd, context.home)
  if (!shared || !parsed.operands.length) return
  let remote = false
  for (const { value } of parsed.operands) {
    const spec = value.startsWith('scp://') ? value : remoteOf(value)
    if (spec === undefined) {
      if (!safeLocal(value, cwd, context)) return
      continue
    }
    const target = value.startsWith('scp://') ? uriTarget(value, 'scp') : targetOf(spec)
    if (!target || !allows(hosts, target, shared.keys, context.home)) return
    remote = true
  }
  return remote ? { exempt: shared.exempt } : undefined
}

const sftp = (args: string[], hosts: SshHost[], cwd: string, context: ReadContext): Verdict => {
  // No -b batch file (it could put any local file) and no -D, -S or -s programs.
  const parsed = parseShort(args, '46aACfNpqrv', 'BcFilPoR')
  const shared = parsed && sshOptions(parsed.options, cwd, context.home)
  if (!shared || parsed.operands.length !== 1) return
  const destination = parsed.operands[0]!.value
  const target = destination.startsWith('sftp://')
    ? uriTarget(destination, 'sftp')
    : targetOf(destination.includes(':') ? destination.slice(0, destination.indexOf(':')) : destination)
  return target && allows(hosts, target, shared.keys, context.home) ? { exempt: shared.exempt } : undefined
}

// rsync over ssh: its -e/--rsh must be a plain ssh with trusted options and no destination of its own. Daemon paths
// (host::module, rsync://) aren't ssh.
const RSYNC_REFUSED = ['--daemon', '--server', '--sender', '--config', '--rsync-path', '--write-devices']
const rsync = (args: string[], hosts: SshHost[], cwd: string, context: ReadContext): Verdict => {
  const exempt = new Set<number>()
  let keys: string[] = []
  let user: string | undefined
  const transport = (value: string, at: number) => {
    const tokens = tokenize(value)
    const commands = tokens && commandsOf(tokens)
    const words = commands?.length === 1 ? commands[0]! : undefined
    if (!words || words[0]?.text !== 'ssh' || words.some((w) => w.globbed)) return false
    const inner = words.slice(1).map((w) => (w.tilde ? expandHome(w.text, context.home) : w.text))
    const parsed = parseShort(inner, '46AaCqTvx', 'cFilop')
    const shared = parsed && sshOptions(parsed.options, cwd, context.home)
    if (!shared || parsed.operands.length) return false
    keys = shared.keys
    user = parsed.options.findLast((o) => o.flag === 'l')?.value
    exempt.add(at)
    return true
  }
  const operands: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      operands.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const name = arg.split('=')[0]!
      if (RSYNC_REFUSED.includes(name)) return
      if (name === '--rsh') {
        const inline = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : undefined
        if (inline === undefined && i + 1 >= args.length) return
        if (!transport(inline ?? args[++i]!, i)) return
      }
      // A long option's value written as the next word is read as an operand: checked like one, so never trusted less.
      continue
    }
    if (arg.startsWith('-') && arg !== '-') {
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j]!
        if (!'eBfTM'.includes(flag)) continue
        const inline = arg.slice(j + 1)
        if (!inline && i + 1 >= args.length) return
        const value = inline || args[++i]!
        if (flag === 'e' && !transport(value, i)) return
        break
      }
      continue
    }
    operands.push(arg)
  }
  let remote = false
  for (const operand of operands) {
    if (operand.startsWith('rsync://')) return
    const spec = remoteOf(operand)
    if (spec === undefined) {
      if (!safeLocal(operand, cwd, context)) return
      continue
    }
    if (operand.slice(spec.length).startsWith('::')) return
    const target = targetOf(spec, user)
    if (!target || !allows(hosts, target, keys, context.home)) return
    remote = true
  }
  return remote ? { exempt } : undefined
}

const PROGRAMS: Record<string, typeof ssh> = { ssh, scp, sftp, rsync }

// --- Variables ---

type Values = Map<string, string[]>
const MAX_BINDINGS = 64
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/
const KEYWORDS = new Set(['do', 'then', 'else', 'if', 'elif', 'while', 'until'])

// A word with no variables or ~: its text.
const plainOf = (word: Word | undefined) =>
  word && !word.tilde && word.parts.every((part) => 'text' in part) ? word.text : undefined

const assignmentOf = (word: Word) => {
  const first = word.parts[0]
  return first && 'text' in first && !first.quoted ? ASSIGNMENT.exec(first.text)?.[1] : undefined
}

// The word's text with its variables set from one binding and ~ expanded. Undefined for a variable never set in the
// command, an unquoted one that would split or glob, or ~user.
const expand = (word: Word, binding: Map<string, string>, home: string): string | undefined => {
  let out = ''
  for (const [i, part] of word.parts.entries()) {
    if ('text' in part) {
      let text = part.text
      if (i === 0 && word.tilde) {
        if (!/^~(?:\/|$)/.test(text) || (text === '~' && word.parts.length > 1)) return
        text = expandHome(text, home)
      }
      // NAME=~/x: the shell expands ~ after an assignment's =.
      if (i === 0 && !part.quoted && ASSIGNMENT.test(text)) {
        const name = ASSIGNMENT.exec(text)![0]
        const value = text.slice(name.length)
        if (value.startsWith('~')) {
          if (!/^~(?:\/|$)/.test(value) || (value === '~' && word.parts.length > 1)) return
          text = name + expandHome(value, home)
        }
      }
      out += text
      continue
    }
    const value = part.name === 'HOME' ? home : binding.get(part.name)
    if (value === undefined) return
    if (!part.quoted && (!value || /[\s*?[]/.test(value))) return
    out += value
  }
  return out
}

// Every way the variables these words use can be set: one binding per combination of a loop's values.
const bindingsOf = (words: Word[], values: Values): Map<string, string>[] | undefined => {
  const names = new Set(words.flatMap((word) => word.parts.flatMap((part) => ('name' in part && part.name !== 'HOME' ? [part.name] : []))))
  let bindings = [new Map<string, string>()]
  for (const name of names) {
    const options = values.get(name)
    if (!options) return
    bindings = bindings.flatMap((binding) => options.map((value) => new Map([...binding, [name, value]])))
    if (bindings.length > MAX_BINDINGS) return
  }
  return bindings
}

// --- The command ---

// True if the command reaches at least one server through ssh, scp, sftp or rsync, every such reach is to an allowed
// host with only its listed key, and nothing else in it would ask: no other network command, and no login or key
// named outside those keys. context is the policy's reading context (its cwd, home, secrets and .env choice).
export const trustsSshHosts = (command: string, hosts: SshHost[], context: ReadContext): boolean => {
  if (!hosts.length) return false
  const tokens = tokenize(command, true)
  const targets: { word: Word; command: number }[] = []
  const commands = tokens && commandsOf(tokens, targets)
  if (!commands?.length) return false
  const values: Values = new Map()
  let cwd = context.cwd
  let reached = false
  const named = (text: string, at: string) => mentionsSecret(text, { ...context, cwd: at })
  for (const [index, raw] of commands.entries()) {
    // Redirects first: their files are local, and may never be a login or key.
    for (const { word } of targets.filter((target) => target.command === index)) {
      const bindings = bindingsOf([word], values)
      if (!bindings) return false
      for (const binding of bindings) {
        const path = expand(word, binding, context.home)
        if (path === undefined || isSecret(path, { ...context, cwd }) || named(path, cwd)) return false
      }
    }
    let words = raw
    while (words.length && KEYWORDS.has(plainOf(words[0]) ?? '')) words = words.slice(1)
    if (!words.length) continue
    const first = plainOf(words[0])
    if (first === 'done' || first === 'fi') {
      if (words.length > 1) return false
      continue
    }
    if (first === 'for') {
      const name = plainOf(words[1])
      if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || plainOf(words[2]) !== 'in') return false
      const list: string[] = []
      for (const word of words.slice(3)) {
        const bindings = bindingsOf([word], values)
        if (!bindings || word.globbed) return false
        for (const binding of bindings) {
          const value = expand(word, binding, context.home)
          if (value === undefined) return false
          list.push(value)
        }
      }
      if (!list.length || list.length > MAX_BINDINGS) return false
      values.set(name, list)
      continue
    }
    // NAME=value ... alone (or after export) sets variables for the rest of the command.
    const rest = first === 'export' ? words.slice(1) : words
    if (rest.length && rest.every((word) => assignmentOf(word) !== undefined)) {
      for (const word of rest) {
        const bindings = bindingsOf([word], values)
        if (!bindings) return false
        const name = assignmentOf(word)!
        const set: string[] = []
        for (const binding of bindings) {
          const text = expand(word, binding, context.home)
          if (text === undefined) return false
          set.push(text.slice(name.length + 1))
        }
        values.set(name, [...new Set(set)])
      }
      continue
    }
    const bindings = bindingsOf(words, values)
    if (!bindings) return false
    const prefixed = words.findIndex((word) => assignmentOf(word) === undefined)
    const program = plainOf(words[prefixed])
    const check = program === undefined ? undefined : PROGRAMS[program]
    let to: string | undefined
    for (const binding of bindings) {
      const texts = words.map((word) => expand(word, binding, context.home))
      if (texts.some((text) => text === undefined)) return false
      const args = (texts as string[]).slice(prefixed + 1)
      if (check) {
        // FOO=bar ssh ... could point ssh somewhere else (SSH_ASKPASS, GIT_SSH...).
        if (prefixed > 0) return false
        const verdict = check(args, hosts, cwd, context)
        if (!verdict) return false
        const others = args.filter((_, i) => !verdict.exempt.has(i))
        if (named(others.join(' '), cwd)) return false
        reached = true
        continue
      }
      const text = (texts as string[]).join(' ')
      if (ASKS_FIRST.test(text) || named(text, cwd)) return false
      if (args.some((arg) => isSecret(arg, { ...context, cwd }))) return false
      if (program === 'cd') {
        if (args.length > 1 || args[0] === '-' || (to !== undefined && to !== (args[0] ?? context.home))) return false
        to = args[0] ?? context.home
      }
    }
    if (to !== undefined) cwd = resolve(cwd, to)
  }
  return reached
}
