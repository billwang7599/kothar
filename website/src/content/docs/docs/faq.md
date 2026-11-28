---
title: FAQ
description: Common questions about Kothar.
---

## Does Kothar include a model or an engine?

No. You bring the engines: Claude Code, Codex, OpenCode, pi or any ACP agent, each signed in with your own account.
Kothar drives them.

## Does it run on Windows or Linux?

The app is built for macOS on Apple Silicon. The core and UI also run on Linux from source, but sandboxing is macOS
only, so there every command asks before it runs.

## Is there a released build?

Yes. Signed and notarized builds for macOS 13+ on Apple silicon are on
[GitHub Releases](https://github.com/billwang7599/kothar/releases). Kothar is in early development and doesn't
update itself yet, so download new versions from there. You can also
[run it from source](/docs/getting-started/#run-from-source).

## Where does Kothar keep my data?

In the **garage**: `~/Library/Application Support/Kothar/`. Settings, accounts, the global `AGENTS.md` and every chat
with its memory are plain files there (Markdown, JSON, JSONL). Agents work in your **work folder**, picked on first
run.

## Will agents change my own folders?

Only if you let them. Git folders are checked out as worktrees in the work folder, so your checkout, its branch and
config stay untouched. Other folders follow their mode: **Edit in place**, **Work on a copy** or **Read only**. See
[Permissions](/docs/permissions/).

## Why don't my engine's plugins, hooks or MCP servers load?

Sessions start clean on purpose, so every engine sees exactly what Kothar gives it. Add MCP servers with the
**MCP servers** extension and skills with **Skills**, and they work on every engine.

## Why is there a cost on my subscription?

Costs are the engines' own figures at API prices. A subscription is billed differently, so read them as a guide. See
[Usage and cost](/docs/usage/).

## Can I use my existing harness extensions?

Not directly. Kothar extensions work with every engine, so they can't rely on one engine's plugin system. See
[Writing an extension](/docs/writing-an-extension/).

## What's the licence?

Kothar is open source. Its core, app and built-in extensions are under the Apache License 2.0: use it, change it
and share it for anything, including commercial work. The extension API is MIT.
