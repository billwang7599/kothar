---
title: Getting started
description: Install Kothar, turn on an engine and make your first space.
---

## Install

Kothar runs on macOS on Apple Silicon.

1. Download the latest `Kothar-<version>-arm64.dmg` from
   [GitHub Releases](https://github.com/billwang7599/kothar/releases).
2. Open the DMG and drag **Kothar** into **Applications**.
3. Open Kothar from Applications.

:::note
Kothar is in early development, and releases may not be published yet. Until then you can
[run it from source](#run-from-source).
:::

## Pick a work folder

On first run, Kothar asks for a **work folder**. Agents work there: each space gets its own folder inside it, and git
folders are checked out there as worktrees. Your own folders stay as they are unless you let agents edit them.

You can change it later in **Settings → Work folder**. A change applies to new spaces only.

## Turn on an engine

Every engine starts off. Kothar doesn't install engines for you.

1. Install an engine's CLI the usual way, such as Claude Code (`claude`) or Codex (`codex`), and sign in to it once.
2. Open **Settings → Engines**. Each engine shows whether it's installed and signed in.
3. Turn on the ones you want.

See [Engines](/docs/engines/) for accounts, API keys and adding an ACP agent.

## Make your first space

1. Click **New space** in the sidebar (⌘N) and give the space a name.
2. Add a folder to it in the right panel's **Context** tab. In the desktop app, **File → New space from folder…**
   (⌘⇧O) does both steps at once.
3. Type a message and press Enter.

The reply streams in with its tool calls. When the agent wants to do something that needs your OK, a card appears in
the chat with **Approve** and **Deny**.

Next, read [Spaces, chats and Home](/docs/spaces/).

## Run from source

You need Node 26 or later and macOS for the full app.

```sh
git clone https://github.com/billwang7599/kothar.git
cd kothar
npm ci
npm run desktop   # builds the UI, then opens the app
```

`npm run dev` runs the core and opens the UI in a browser tab instead. Both use your real garage
(`~/Library/Application Support/Kothar/`). To keep your own chats out of it, point it at a scratch folder:

```sh
KOTHAR_GARAGE=/tmp/k/garage KOTHAR_WORK=/tmp/k/work npm run dev
```
