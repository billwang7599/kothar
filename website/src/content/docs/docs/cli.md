---
title: Command line
description: Drive a running Kothar from a terminal or a script with the kothar CLI.
---

`kothar` drives a running Kothar (the app, or `npm run dev`) from a terminal or a script.

It isn't in the DMG yet. Run it from a clone of the repo with `npm run kothar -- <command>`, or put it on your path
with `npm link -w @kothar/cli`.

## Commands

```sh
kothar list                          # spaces and their workers, with status (--json for scripts)
kothar new ~/code/app --name App     # make a space on a folder; prints its id
kothar send App "fix the failing test" --wait
                                     # stream the reply; exit when the turn ends
kothar status App                    # status, engine, model, queue, what it's waiting for
kothar read App --last 5             # the latest messages (--tools adds tool calls)
kothar stop App                      # stop the running turn
kothar approve App                   # approve the permission request it's waiting on
kothar deny App                      # or deny it
```

Name a chat by its id, the start of its id, or a space's name. Home is `home`.

## send --wait

`send --wait` streams the reply and exits when the turn ends:

| Exit code | Meaning |
|---|---|
| `0` | The turn ended. |
| `1` | The turn failed. |
| `3` | It stopped at a permission request or a question. The chat keeps waiting for `approve`, `deny` or the app. |
| `4` | `--timeout` ran out. |

`--approve` approves every request during the wait. Leave it off unless you'd have clicked **Approve** on all of them
anyway. Ctrl+C stops waiting but leaves the turn running.
