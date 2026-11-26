// Model roles: which model list (Settings → Models) a chat runs on. Kothar has two of its own, Chat and Workers;
// extensions declare the rest (Extension.modelRoles), such as Plan's 'planning' and Deep Research's 'searching'. This
// decides which roles exist and which are live (declared by an extension that's on); models.ts keeps the lists.
//
// Role ids aren't namespaced: a role's id is the key its list is saved under (settings.json models.<id>), so Plan's
// and Deep Research's lists from before roles were declarable keep working as they were. The first extension to
// declare an id keeps it; a clash is left out and shown on the later extension.
import type { Extension, ExtensionModelRole } from '@kothar/extension-api'
import { CORE_MODEL_ROLES, MODEL_ROLE_ID, ROLE_NAMES, type CoreModelRole, type ModelRole } from './shared.ts'

export type DeclaredRole = ExtensionModelRole & { extension: Extension }

const isCore = (role: unknown): role is CoreModelRole => CORE_MODEL_ROLES.includes(role as CoreModelRole)

/** Each extension's declared roles, checked: the valid ones, and why any were left out, by extension id. */
export function declaredRoles(extensions: readonly Extension[]) {
  const roles: DeclaredRole[] = []
  const problems = new Map<string, string[]>()
  const problem = (extension: Extension, text: string) =>
    problems.set(extension.id, [...(problems.get(extension.id) ?? []), text])
  for (const extension of extensions) {
    const declared: unknown = extension.modelRoles
    if (declared === undefined) continue
    if (!Array.isArray(declared)) {
      problem(extension, 'modelRoles must be a list')
      continue
    }
    for (const role of declared as unknown[]) {
      const { id, label, description } = (typeof role === 'object' && role !== null ? role : {}) as Record<string, unknown>
      const name = typeof id === 'string' ? `Model role "${id}"` : 'A model role'
      if (typeof id !== 'string' || !MODEL_ROLE_ID.test(id)) {
        problem(extension, `${name} was left out: its id must be lowercase letters, digits and dashes`)
      } else if (isCore(id)) {
        problem(extension, `${name} was left out: it's one of Kothar's own`)
      } else if (roles.some((r) => r.id === id)) {
        const owner = roles.find((r) => r.id === id)!.extension
        problem(extension, `${name} was left out: ${owner.id === extension.id ? 'it is declared twice' : `${owner.name} declares it`}`)
      } else if (typeof label !== 'string' || !label.trim()) {
        problem(extension, `${name} was left out: it needs a label`)
      } else {
        roles.push({
          id,
          label: label.trim(),
          ...(typeof description === 'string' && description.trim() && { description: description.trim() }),
          extension,
        })
      }
    }
  }
  return { roles, problems: new Map([...problems].map(([id, texts]) => [id, texts.join('. ')])) }
}

export function openModelRoles(extensions: readonly Extension[], isOn: (extension: Extension) => boolean) {
  const { roles, problems } = declaredRoles(extensions)
  const owner = (role: ModelRole) => roles.find((r) => r.id === role)
  return {
    // Why an extension's roles were left out, by its id; shown on it like a load error.
    problems,
    // Kothar's own roles, or one an extension declares, whether it's on or not: a list can be saved for it.
    known: (role: unknown): role is ModelRole => isCore(role) || (typeof role === 'string' && owner(role) !== undefined),
    // Kothar's own roles, or one an extension that's on declares: a chat can be started or run on it.
    live: (role: unknown): role is ModelRole => {
      if (isCore(role)) return true
      const declared = typeof role === 'string' ? owner(role) : undefined
      return declared !== undefined && isOn(declared.extension)
    },
    // A role's name in Settings → Models: "Planning".
    label: (role: ModelRole) => (isCore(role) ? ROLE_NAMES[role] : (owner(role)?.label ?? role)),
    // The roles this extension declares, as the UI gets them.
    of: (extension: Extension): ExtensionModelRole[] =>
      roles.filter((r) => r.extension === extension).map(({ extension: _, ...role }) => role),
    // The roles extensions on for a chat declare (`isOnFor`): what its spawn_worker may name.
    for: (isOnFor: (extension: Extension) => boolean): DeclaredRole[] => roles.filter((r) => isOnFor(r.extension)),
  }
}

export type ModelRoles = ReturnType<typeof openModelRoles>

// Only Kothar's own roles, for code that runs without extensions (tests, and models.ts by default).
export const CORE_ROLES: Pick<ModelRoles, 'known' | 'live' | 'label'> = {
  known: isCore,
  live: isCore,
  label: (role) => (isCore(role) ? ROLE_NAMES[role] : role),
}
