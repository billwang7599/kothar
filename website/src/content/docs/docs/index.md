---
title: Kothar docs
description: What Kothar is and where to start.
---

Kothar is a desktop app for running coding agents. You bring the engines: coding-agent CLIs like Claude Code, Codex,
OpenCode and pi, or any agent that speaks the Agent Client Protocol (ACP). Kothar gives you one place to drive them all.

Kothar keeps a small core and does the rest with **extensions**. An extension is written once and works with every
engine.

## Words used in these docs

| Word | Meaning |
|---|---|
| **Engine** | A coding agent Kothar drives: Claude Code, Codex, OpenCode, pi or an ACP agent. |
| **Space** | A named chat with its own folders, files and `AGENTS.md`. Most work happens in a space. |
| **Chat** | A conversation. Each space is a chat, and so are Home and workers. Chats never run out and survive restarts. |
| **Home** | Your personal assistant: one chat that sees every space and can make new ones. |
| **Worker** | A chat an agent starts to handle one task beside it. Its report comes back to the agent that started it. |
| **Extension** | Adds panels, commands, tools or rules to Kothar, for every engine at once. |
| **Garage** | The folder where Kothar keeps settings, accounts and every chat, as plain files. |

## Where to go next

- [Getting started](/docs/getting-started/): install Kothar and make your first space.
- [Engines](/docs/engines/): turn on an engine and sign in.
- [Permissions](/docs/permissions/): decide what agents may do without asking.
- [Writing an extension](/docs/writing-an-extension/): build your own.

Kothar is in early development. It runs on macOS. The core and UI also run on Linux from source, but without the
sandbox.
