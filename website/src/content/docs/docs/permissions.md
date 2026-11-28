---
title: Permissions
description: The sandbox, folder modes, permission switches, Allow all, read-only turns and SSH hosts.
---

Kothar decides what an agent may do without asking. Anything else shows a card in the chat with **Approve** and
**Deny**. Every tool row then shows its verdict, and an automatic answer says which rule made it.

## The sandbox (macOS)

Agents work in a sandboxed work folder. A space's agent writes only in its own folder in the work folder, in its git
checkouts there, and in folders you set to **Edit in place**. It can read elsewhere.

Nothing an agent runs can put up a macOS authorization or keychain dialog. Keychain logins keep working.

Sandboxing is macOS only. On other systems, every command asks.

## Folder modes

Each attached folder that isn't a git repo has a mode, picked in the **Context** tab:

| Mode | What agents can do |
|---|---|
| **Edit in place** (default) | Write in the folder itself. Logins, keys and `.env` files in it still ask. |
| **Work on a copy** | Work on a copy in the work folder. **Copy changes back** shows what changed and copies your pick back. |
| **Read only** | Read the folder, never write in it. |

Git folders are always checked out as worktrees in the work folder instead. A folder holding Kothar's own data is always
read only.

## Switches

Each chat's **Permissions** tab has these switches. Their defaults live in **Settings → Work folder**; a pick in a
chat's tab is for that chat only.

| Switch | On means |
|---|---|
| **Allow all** | No sandbox, and every request is approved without asking, logins and keys included. Only Read only folders stay read only. |
| **Allow edits outside the work folder, asking first** | No sandbox. Edits outside the work folder ask you first, instead of being denied. |
| **Run commands without asking** | Shell commands run without asking, while the chat is sandboxed. |
| **Run network commands without asking** | Commands that publish or reach the network (such as `git push`, `curl`, `ssh`) run without asking too. |
| **Read anywhere without asking** | Reads outside the work folder, and commands that only read, run without asking. Logins and keys still ask. |
| **Let commands use .env files without asking** | Under **More**. Sandboxed commands may read and edit a project's `.env` files. |
| **Fetch web pages without asking** | Under **More**. Agents read web pages and search without asking. |

While **Allow all** is on, the other switches are folded away and kept for when you turn it off. It shows an amber
chip in the chat header. Switch changes apply from the chat's next message.

## Read-only turns

Some turns are read only, such as a **Plan first** message while the agent works out its plan. Edits are refused on
every engine, by the sandbox and by Kothar's answers, until you approve the plan.

## SSH hosts

**Allowed SSH hosts** let `ssh`, `scp` and `rsync` to servers you trust (with the key you name) run without asking.

- Set them in **Settings → Work folder** for all spaces, or in a space's **Permissions** tab for that space. A space trusts both
  lists together.
- A card for a command that reaches an SSH server offers **Always allow &lt;host&gt;**, for this space or for all
  spaces. It approves the command and adds the server to that list.

## Engines that never ask

pi never asks before running a tool, so pi sessions get no permission cards. Only the sandbox limits them.
