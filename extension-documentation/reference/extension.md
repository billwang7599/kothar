---
title: The extension object
description: Every field of the Extension type, with links to the page that covers it.
---

# The extension object

An extension is an object of type `Extension`, the default export of its module. This page lists every field. The pages
after it cover each group in detail.

## Required fields

| Field | Type | What it is |
|---|---|---|
| `id` | `string` | Lowercase letters, digits and dashes. The same as the manifest's `id`. |
| `name` | `string` | Shown in Settings and in errors. |
| `description` | `string` | One or two sentences, shown in Settings. |
| `enabledByDefault` | `boolean` | Whether a built-in extension starts on. Community extensions always start off, so set it to `false`. |

## Optional fields

| Field | What it adds | Page |
|---|---|---|
| `alwaysOn` | Built-in extensions only: part of Kothar, with no switch. It isn't listed under Built-in extensions, its page sits under Options, and a saved "off" is ignored. Home sets it. A community extension's is ignored | — |
| `settings` | Settings on the extension's own page in Settings | [Settings and setup](settings.md) |
| `spaceSettings` | Settings kept per space, shown in the extension's panels | [Settings and setup](settings.md#settings-per-space) |
| `settingsVersion`, `migrateSettings` | Updating saved settings once when their shape changes | [Settings and setup](settings.md#migrating-saved-settings) |
| `settingsView`, `onSettingsChanged` | A readout and buttons of the extension's own on its Settings page, and a hook for a changed setting | [Settings and setup](settings.md#a-view-of-its-own) |
| `prompts` | Text sent to agents that the user can read and edit in Settings | [Settings and setup](settings.md#prompts) |
| `setup` | A check and an install step for something the extension needs | [Settings and setup](settings.md#setup) |
| `tools` | Tools agents can call | [Tools, MCP servers, instructions and memory](agents.md#tools) |
| `toolsFor` | More tools, made for each chat as its session starts (such as tools relayed from another MCP server); `result: 'mcp'` on a tool passes its MCP content through as it is | [Tools, MCP servers, instructions and memory](agents.md#tools) |
| `mcpServers` | MCP servers for each session | [Tools, MCP servers, instructions and memory](agents.md#mcp-servers) |
| `instructions` | Text added to each session's instructions | [Tools, MCP servers, instructions and memory](agents.md#instructions) |
| `panels` | Tabs in the right sidebar | [Panels and commands](panels.md#panels) |
| `commands` | Actions in a chat's General tab | [Panels and commands](panels.md#commands) |
| `messageActions` | Buttons on each message in the transcript, such as Pin | [Panels and commands](panels.md#message-actions) |
| `messageDetails` | Folded rows under messages in the transcript, drawn when opened, such as What was sent | [Panels and commands](panels.md#message-details) |
| `noteViews` | Live cards in the transcript, drawn and updated by the extension, such as a research run's progress | [Panels and commands](panels.md#live-cards) |
| `composerToggles` | Modes in the composer's mode picker, such as Deep research: one at a time, for the next message | [Panels and commands](panels.md#composer-modes) |
| `chats` | Chats of the extension's own | [Chats](#chats), below |
| `modelRoles` | Model lists of its own in Settings → Models, for the workers it starts and the turns it runs | [Model roles](#model-roles), below |
| `memory` | What each session sees of its chat's history | [Tools, MCP servers, instructions and memory](agents.md#memory) |
| `optionalDependencies`, `requires`, `onDependencyChanged` | Working with another extension: features that turn on with it, or not running without it | [Depending on other extensions](dependencies.md) |
| `provides` | Capability names it shares an API under, for others to get with `host.use` | [Capabilities](dependencies.md#capabilities-provide-and-use) |
| `replaces` | Engines' own built-in tools it stands in for, turned off while it's on | [Replacing engines' tools](../working-together.md#replacing-engines-own-tools) |
| `onStart`, `onStop` | Start and stop background work | [Events and hooks](events.md#background-work) |
| `onChatCreated`, `onChatRemoved`, `onChatArchived`, `onMessagesRemoved`, `onSpaceRemoved`, `onStatusChanged`, `onTurnStarted`, `onTurnCompleted`, `onSessionEnded`, `onEvent`, `onLimitReached` | Hooks that react to chats as they run | [Events and hooks](events.md) |
| `onPermissionRequested` | A policy that answers permission requests | [Events and hooks](events.md#onpermissionrequested) |
| `onTurnSent` | Everything a turn's session was sent, labelled, as it opens | [Events and hooks](events.md#onturnsent) |
| `onUsage` | What engines reported each turn and one-shot call used | [Events and hooks](events.md#onusage) |
| `turnOptions` | Makes a turn read only, or runs it on another model list | [Events and hooks](events.md#turnoptions) |
| `transformMessage`, `transformOutput` | Rewrites of messages and replies | [Events and hooks](events.md#transforms) |
| `onWaitAction` | The user's answer to the extension's wait on a chat | [The host](host.md#waiting-for-the-user) |
| `processes`, `onProcessAction`, `onProcessesChanged` | Rows of the extension's own in the Processes tab | [The host](host.md#processes-rows) |

## Chats

`chats` gives an extension chats of its own. Home is one: the built-in Home extension (always on, see `alwaysOn`)
declares a single chat, and its tools let that chat make spaces.

```ts
import type { Extension } from '@kothar/extension-api'

const journal: Extension = {
  id: 'journal',
  name: 'Journal',
  description: 'A pinned chat that keeps a daily journal with you.',
  enabledByDefault: false,
  chats: [
    {
      id: 'journal',
      name: 'Journal',
      instructions: 'You help the user keep a short daily journal. Ask one question at a time.',
    },
  ],
}

export default journal
```

A `ExtensionChat` has:

| Field | Type | What it is |
|---|---|---|
| `id` | `string` | The chat's id. No other extension's chat may have it. |
| `name` | `string` | Shown in the sidebar. |
| `instructions` | `string` | The chat's role, given first in every session's instructions. |
| `prompt` | `string`, optional | The id of one of the extension's [prompts](settings.md#prompts) (`where: 'instructions'`, its `text` the same as `instructions`) that holds the role, so the user can edit it in Settings. Kothar then sends the user's edit. Home's is `role`. |
| `seesAll` | `boolean`, optional | The chat can list, read and message every chat through Kothar's own tools, as Home does. |

An extension's chat is pinned. It can't be renamed, archived or deleted, and it keeps no folders, files or `AGENTS.md`
of its own. When the extension is off, its chats are hidden and their history stays.

List `chats` in the manifest's `uses`.

## Model roles

Kothar has two model lists of its own in **Settings → Models**: Chat, and Workers (every worker no other list is for).
An extension adds more with `modelRoles`, each `{ id, label, description? }`. While the extension is on, each shows as
a list in Settings → Models, under its `label` with its `description`, and its `id` can be named:

- as `role` in [`host.createChat`](host.md#start-a-worker) with a `parentId`, for the workers it starts;
- as `role` in [`turnOptions`](events.md#turnoptions), for a turn of a chat it's on for;
- by agents, as `spawn_worker`'s `role`, in chats the extension is on for.

A role whose list is empty runs on the Chat list. While the extension is off, its lists are hidden and kept, a role it
declares is refused where one is given, and a chat already on one runs on the Chat list.

```ts
const plan: Extension = {
  // …
  modelRoles: [{ id: 'planning', label: 'Planning', description: 'Turns that work out a plan, and workers started to plan.' }],
  turnOptions: (chat, { host }) => (host.toggled(chat.id, 'plan') ? { readOnly: true, role: 'planning' } : undefined),
}
```

- An `id` is lowercase letters, digits and dashes, starting with a letter. It can't be `chat` or `workers`.
- Ids aren't namespaced: the user's list is saved under the id (`models.<id>` in `settings.json`), so changing an id
  drops the user's list. The first extension to declare an id keeps it; a later one's is left out, and its page says
  why. A community extension should start its ids with its own id (`my-extension-review`).
- Plan declares `planning` and Deep Research `searching`, the ids those lists had before extensions could declare them.

List `sendMessages` in the manifest's `uses`.

## Rules for every hook

- Hooks run in Kothar's core, not in the window.
- A hook that throws, or a promise that rejects, shows its error as "Extension name: message" and doesn't stop the chat.
- Kothar doesn't wait for async hooks, except `onPermissionRequested`, a tool's `run`, and a panel's `render` and
  `onAction`.
- Extensions are called in load order: built-in extensions first, then community extensions.
- A chat's setup (Settings → Setups) can leave an extension that's on out of that chat's sessions. For those chats
  Kothar doesn't call its `mcpServers`, `instructions`, `memory`, `transformMessage`, `transformOutput` or
  `onPermissionRequested`, the Kothar MCP server doesn't offer its `tools`, and the chat doesn't show its `panels` or
  `commands`. An extension's own chat always keeps it. Hooks that only report what happened
  (`onTurnStarted`, `onStatusChanged`, `onEvent` and the rest) still run for every chat.
