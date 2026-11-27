---
title: Writing an extension
description: What an extension is, the shape of the public extension API, and a budget example using onUsage.
---

An extension is one JavaScript object, written against Kothar's public extension API (`@kothar/extension-api`, MIT
licensed). Kothar reads its fields and calls its hooks. It works with every engine Kothar drives.

The full guide and API reference live in the repo:
[extension-documentation](https://github.com/billwang7599/kothar/tree/main/extension-documentation). This page is
the short version.

## A whole extension

This one adds a **Say hello** command to every chat's **General** tab:

```ts
import type { Extension } from '@kothar/extension-api'

const hello: Extension = {
  id: 'hello',
  name: 'Hello',
  description: 'Adds a command that writes a greeting into the chat.',
  enabledByDefault: false,
  commands: [
    {
      id: 'greet',
      label: 'Say hello',
      run(chat, { host }) {
        host.note(chat.id, 'Hello!')
      },
    },
  ],
}

export default hello
```

## What extensions can do

Extensions reach engines only through what every engine shares:

- **Sessions and prompts:** send messages, start chats and workers, retry or continue a turn, stop one.
- **Streamed output:** see every event as it arrives: text, thinking, tool calls, permission requests and the end of
  each turn.
- **Permission requests:** allow or deny what an agent asks to do.
- **Session start:** give each session MCP servers, tools and extra instructions.

On top of those, an extension can add panels to the right sidebar, commands, settings with a Settings page of its own,
chats of its own, and a setup step that installs what it needs.

## What they can't do

An extension can't change how an engine works inside a turn. It can't filter the agent's context mid-turn, route each
turn to a different model, or hook into an engine's own plugins. That limit is what lets one extension work with every
engine.

## Example: a budget with onUsage

`onUsage` gets each report of what an engine's model calls used. `host.usage(chatId)` reads the totals for a chat, its
workers and its whole space. Together they're enough for a budget:

```ts
import type { Extension } from '@kothar/extension-api'

const LIMIT_USD = 5

const budget: Extension = {
  id: 'budget',
  name: 'Budget',
  description: 'Stops a space’s turns once it has cost $5.',
  enabledByDefault: false,
  onUsage({ chat }, { host }) {
    if (!chat || host.usage(chat.id).space.costUsd < LIMIT_USD) return
    if (host.chat(chat.id)?.status === 'running') host.interrupt(chat.id)
    host.note(chat.id, `This space has cost over $${LIMIT_USD}.`)
  },
}

export default budget
```

A community extension lists `readChats` in its manifest's `uses` to read usage. Costs are what engines report at API
prices, so treat them as a guide. Codex reports no cost.

## Start from the template

1. Make a repo from the template [kothar-sample-mod](https://github.com/billwang7599/kothar-sample-mod) (**Use this
   template** on GitHub). It holds **Hello**, a small example with a panel, a command, a setting and a tool.
2. Run `npm install`, then edit `src/index.ts` and `manifest.json`.
3. Try it in Kothar with **Install from folder…** in the Marketplace window (**Browse…** in **Settings → Community
   hub**).
4. To publish, follow the
   [author guide](https://github.com/billwang7599/kothar-marketplace#submit-a-theme-or-extension).

The manifest lists what the extension uses, such as `panels`, `commands`, `settings`, `tools`, `events`, `readChats`,
`run` or `sendMessages`. Kothar shows that list before install and refuses to start an extension that does more.
