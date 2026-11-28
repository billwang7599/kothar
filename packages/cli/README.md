# @kothar/cli

The `kothar` command: drives a running Kothar (the desktop app or `npm run dev`) from a terminal or a script, over
the same WebSocket protocol the app's window uses. It finds the core through `<garage>/cli.json`, which a running core
writes with its port and a token of its own for the CLI.

It isn't in the DMG yet. From a clone, run `npm run kothar -- <command>`, or put it on your path with
`npm link -w @kothar/cli`. The commands and exit codes are in the root [README](../../README.md#command-line) and in
the [CLI docs](https://kothar.sh/docs/cli/).
