---
title: Spaces, chats and Home
description: How spaces, chats and Home work, and how to give a space its context.
---

## Spaces

A **space** is a named chat with its own folders, files and `AGENTS.md`. Give each project or long-running task its
own space.

- **New space** in the sidebar (⌘N) makes one. **File → New space from folder…** (⌘⇧O) makes one on a folder.
- The agent behind a space is its **lead**. It does small tasks itself and hands bigger ones to
  [workers](/docs/workers/).
- Each space works in its own folder inside your work folder. Git folders are checked out there as worktrees, on a
  branch of their own, so your own checkout stays untouched.
- You can sort spaces into groups in the sidebar. A folded group's dot shows whether anything in it is running or
  waiting for you.

## Chats never run out

A chat is an endless conversation. Each message starts a fresh engine session fed the chat's
[memory](/docs/memory/), so a chat never fills up and survives restarts. Quitting or crashing loses no work: queued
messages are saved and sent when Kothar starts again.

## While a turn runs

- **Enter** steers your message into the running turn at its next step, on engines that support it.
- **⌥Enter** queues it until the turn ends.
- **⌘Enter** interrupts and sends.
- **Stop** asks the engine to stop.

## Context

Each chat's right panel has a **Context** tab. Every message gets the items that are on:

1. The global `AGENTS.md`. Every chat gets it, and you can edit it from any chat.
2. The space's own `AGENTS.md`.
3. Its **folders**. Each folder's own `AGENTS.md` is read in.
4. Its **files**. Text files are pasted in full; other files go by path.

You can turn any item off for one chat. Changes apply from the next message.

You can also attach files to a message with the paperclip, by pasting, or by dropping them on the chat. There's no
size limit. Each file shows its size, and the composer warns when a file is over 20 MB or the files are over 75 MB
together, since big files are slow to send and use a lot of context if an agent reads them. A file over 500 MB asks
before it's attached. Pictures over 20 MB reach the agent as a file path rather than as a picture.

## Setups

A **setup** is a saved choice for a kind of job: an engine and model with its thinking level, extensions to leave out,
and extra instructions. Make setups in **Settings → Setups** and pick one for a space in its **General** tab. Workers
use their space's setup.

## Home

**Home** is your personal assistant, pinned at the top of the sidebar. It's part of Kothar and always on.

- Ask it general questions and personal tasks.
- It sees every space: ask "what's happening everywhere?", or have it send a message to a space.
- It can make new spaces for you.
- It keeps no folders of its own. For ongoing work in a folder, it offers to make a space.

Its role prompt is editable in **Settings → Home**.

## In the chat

- A path to a file in the chat's folders is a link. Click opens it in your editor (**Settings → Work folder → Open
  files with**); right-click shows more.
- Images an agent writes as `![caption](path)` show inline.
- Replies render math with KaTeX, bundled so nothing loads from the web.
