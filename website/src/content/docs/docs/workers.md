---
title: Workers
description: How agents hand tasks to workers, each in its own worktree, and how you review their changes.
---

A **worker** is a chat an agent starts to handle one task beside it. Workers let a space's lead keep talking with you
while the work runs. Extensions start workers for their own work too, such as Deep Research.

## How workers run

- The lead starts a worker with a task. The worker shows nested under its space in the sidebar, and you can open it to
  watch.
- When the worker finishes, its report joins the lead's queue and wakes it. Nothing polls.
- Workers get the same tools as their lead.

**Settings → Workers** sets:

- **Let agents start workers**.
- **Max running per chat**: every worker counts, an extension's too. More wait for a slot.
- **Own worktree per worker** (see below).
- **Prompts**: what agents are told about workers. **Reset** puts back the default.

## A worktree for each worker

In a space with git folders, each worker gets its own git worktree, on a branch of its own (`kothar-worker/…`), made
from the space's checkout. Workers running side by side never edit the same files.

- A space's **Worker setup script** (its **General** tab) runs in each new worktree first, such as `npm ci`. If it
  fails, the worker stops and its lead is told.
- An agent can start a worker with a shared checkout for a task that only reads.
- **Own worktree per worker** in Settings → Workers turns this off for every new worker.

## Review a worker's changes

When a worker reports, its changes (files, lines, commits, anything uncommitted) come with the report and wait for your
review, right under it:

| Button | What it does |
|---|---|
| **Merge** | Commits what the worker left uncommitted and merges its branch into the space's branch. A conflict is undone and reported, and the branch keeps waiting. |
| **Squash** | The same, as one commit on the space's branch. |
| **Keep** | Leaves the branch for later. |
| **Discard…** | Throws the changes away. It asks first. |

The lead can do the same with its `review_worker` tool, but Merge, Squash and Discard wait for you to approve them on a
card. A worker that changed nothing leaves no branch behind.

The **Changes** tab (from the Git extension) lists each worker's checkout beside the space's.

## After a restart

A worker cut off by a quit or crash stays. Its lead gets a report saying so, so it can carry the worker on or start
another.
