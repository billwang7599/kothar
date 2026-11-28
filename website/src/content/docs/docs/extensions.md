---
title: Extensions
description: The built-in extensions, their settings, and community extensions from the marketplace.
---

An **extension** adds panels, commands, tools, prompts or permission rules to Kothar. It's written once and works with
every engine.

Turn built-in extensions on or off in **Settings → Built-in extensions**. An extension with settings gets its own page
there, where its prompts and tool descriptions are also editable. On and off apply from the next message.

## Built-in extensions

| Extension | Starts | What it does |
|---|---|---|
| **Artifacts** | On | Pages, small apps, React components, SVGs, diagrams, documents and code files agents make for you. Kept per space with every version, shown beside the chat, in a library (⌘⇧A), and run in a sandbox, offline. A setting picks whether agents make them only when you ask or whenever useful. |
| **Inspector** | On | Shows what Kothar actually sent the engine for each message, folded under it, each part labelled by who it's from. Its **Activity** tab lists what Kothar and extensions did on their own: model calls, permission answers, workers, retries. |
| **MCP servers** | On | Connects GitHub, Linear, Notion and other MCP servers to every engine. Kothar is their only client, so keys stay in Kothar and each call is asked for and recorded. |
| **Memory** | On | Every chat remembers its whole conversation. See [Memory](/docs/memory/). |
| **Notes** | On | Your Markdown notes, global or per space, in a popup over the chat (⌘⇧N), with search, pins, tags, `[[links]]` and a live-preview editor. Agents read and write them with tools when you ask. |
| **Plan** | On | Pick **Plan first** in the message box's mode menu. The agent can only read while it works out a plan. You approve, edit or cancel it, and the **Plan** tab ticks off its steps. |
| **Processes** | On | Lets agents run dev servers, watchers and other long-running commands that keep going between messages. They belong to the space and stop when it's archived or deleted, or Kothar quits. |
| **Reconnect** | On | When a turn ends because the connection dropped or the service was down, waits for it to come back and carries on. |
| **Skills** | On | Saved instructions for particular kinds of task, in the Agent Skills format (a folder with a `SKILL.md`). Agents on every engine see a one-line list and read a skill when a task fits. |
| **Account rotation** | Off | When a turn hits its account's usage limit, switches to the next saved account and carries on. |
| **Browser** | Off | Agents browse in your own Chrome, with your logins, through the Kothar Chrome extension: a tab group per space. When a page needs you (a sign-in, a CAPTCHA), its tab comes to the front and you do it there. |
| **Deep Research** | Off | Turns a question into a cited report: a plan you approve, workers that search and read the web, and only claims backed by a quote found on their page. Its Research launcher (⌘⇧D) lists every past research. |
| **Git** | Off | A **Changes** tab for spaces with git folders: each checkout's branch, the files changed with their diffs, and its pull request if `gh` is signed in. Read only. |
| **Pins** | Off | Pin messages and find them again in the **Pinned** tab. Agents don't see your pins. |

Each session is told what it can use: Kothar's tools and every extension's, one line each. Agents combine them on their
own, such as handing a deep research run to a worker.

## Community extensions and themes

Community extensions and themes install from the marketplace.

1. Open **Settings → Community hub** and turn on **Community extensions**.
2. Click **Browse…** to open the Marketplace window, then **Install**.
3. Turn the extension on and click **Restart**. Extensions load when Kothar starts.

An extension is code, so it lists what it uses (running programs, reading chats, answering permission requests and so
on). Kothar shows that list before you install it, refuses to start an extension that does more than it listed, and
keeps every community extension off until you turn it on.

A theme is a small JSON file of colours, so it can't change anything else. Kothar ships with **Default** and **Glass**.

Want to build one? See [Writing an extension](/docs/writing-an-extension/).
