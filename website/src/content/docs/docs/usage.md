---
title: Usage and cost
description: What engines report their model calls used, where Kothar keeps it, and where you see it.
---

Kothar keeps what engines report their model calls used: each turn's, and each one-shot call extensions make, such as
memory summaries.

## What each engine reports

| Engine | Tokens | Cost |
|---|---|---|
| Claude Code | Yes, per model | Yes |
| pi | Yes | Yes |
| OpenCode | Yes | Yes |
| Codex | Yes | No |

Costs are the engines' own figures at API prices. On a subscription, your bill is worked out differently, so read them
as a guide.

## Where you see it

- **The chat header** shows a quiet total. For a space, it includes its workers. Hover it for the breakdown.
- **What was sent** (from the Inspector extension), folded under each of your messages, has a row with what that turn
  used.
- **The Activity tab** lists model calls made outside a turn.

## Where it's kept

Each chat keeps its usage in its own `usage.jsonl`, apart from its log. Forgetting or deleting messages doesn't remove
what they cost, and memory never sees these numbers. When a worker is removed, its usage moves to its lead, so the
space's total stays right. Deleting a space deletes its usage.

## Build on it

Extensions read usage with the `onUsage` hook and `host.usage`. See the
[budget example](/docs/writing-an-extension/#example-a-budget-with-onusage).
