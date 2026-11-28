---
title: Memory
description: How every chat remembers its whole conversation, and how to make it forget.
---

Every chat has its own memory. Memory belongs to the chat, not to a folder, and it comes from the built-in **Memory**
extension, which is on by default.

## How it works

Each message starts a fresh engine session. Kothar seeds it with a bounded view of the chat: the latest messages in
full, and older ones as short summaries. A short chat goes in whole.

Summaries are written in the background by a cheap model, through your own engine login, so no extra API key is
needed.

**Settings → Built-in extensions → Memory → Older messages** picks how older messages are kept:

| Mode | What it does |
|---|---|
| **Rolling summary** (default) | One summary of everything older than the latest messages, rewritten as messages leave the view. Few summary calls. |
| **Summary tree (zoomable)** | A line per message and per block, finer toward the present. Agents can zoom back into any line to read the original messages. More detail, many more summary calls. |

With Memory off, a fresh session sees only the latest messages that fit.

## Zoom and date

Agents get two memory tools:

- `zoom` opens a summary line back up, down to a whole message.
- `date` gives the date and time of a message.

A worker can also read its lead's memory, as it was when the worker started.

## Forget something

Ask an agent to forget something, such as "forget the CS343 thing". Its `forget` tool shows a card listing each
message it would remove. Click **Forget** or **Cancel**. With **Allow all** on for the chat, the card is approved
without asking.

Forget removes those messages for good: from the log on disk, their attachments and the chat's memory. Only the chat's
own finished turns can go. A line such as "2 messages forgotten" marks the gap.

## Where it's kept

Memory is plain files in the chat's folder in the garage: its log (`log.jsonl`) and its summaries. Agents and you can
read them with ordinary tools.
