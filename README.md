<p align="center">
  <img src="packages/desktop/assets/icon.png" alt="Kothar's icon: a blue anvil and a spark" width="128" height="128">
</p>

<h1 align="center">Kothar</h1>

<p align="center">A desktop app for running coding agents.</p>

Bring your own engines (coding-agent CLIs like Claude Code, Codex, OpenCode and pi) and drive them all from one place. Kothar
keeps a small core and lets you customize the rest with extensions, which work with every engine.

## Extensions

An extension is written once and works with every engine. It can add panels and commands, react to chats and turns,
answer permission requests, rewrite messages, and run commands, all through Kothar's public extension API.

**Extension documentation:** [extension-documentation/](extension-documentation/index.md) covers using, building and
publishing extensions and themes, with the full API reference.

Community extensions install from the marketplace in Settings, from their authors' own repos. An extension is code, so
it lists what it uses through the extension API (running programs, reading chats, answering permission requests and so
on). Kothar shows that list before you install it, refuses to start an extension that does more than it listed, and
keeps every community extension off until you turn it on. Extensions load when Kothar starts, so turning one on takes a
restart.

**Writing an extension or theme:** start from the template
[billwang7599/kothar-sample-mod](https://github.com/billwang7599/kothar-sample-mod) (or
[kothar-themes](https://github.com/billwang7599/kothar-themes#make-your-own-theme) for a theme). Try it with **Install from
folder…** in the Marketplace window (**Browse…** in Settings → Community hub) before you publish, then follow the
[author guide](https://github.com/billwang7599/kothar-marketplace#submit-a-theme-or-extension) to list it.

## Setups

A setup is a saved choice for a kind of job: an engine and model with its thinking level, extensions to leave out, and
extra instructions. Make them in Settings → Setups and pick one for a space in its General tab. A worker always uses its
closest parent's setup, which is its space's, and can't pick its own. A setup applies from the chat's next message. A model or thinking level picked for the chat
itself still wins, and anything the setup leaves out follows Settings. Each setup is a plain JSON file in
`<garage>/setups/`.

A setup's instructions go into each session after the extensions' instructions and before the context items (the global
`AGENTS.md`, then each chat's), so your own `AGENTS.md` files read last. A setup can switch off extensions that are on,
for its chats only, but it can't turn on one that's off in Settings. Those chats don't get its tools, instructions,
panel tabs or commands. An extension with a chat of its own, such as Home,
always stays on in that chat, so the setup form doesn't list it.

## Themes

Kothar ships with two themes, Default and Glass. More themes, such as Nord, Catppuccin and Gruvbox, come from the
marketplace in Settings. A theme is a small JSON file of colours, checked before it installs, so it can't change
anything but colours.

The marketplace is a catalog of pointers in its own repo,
[billwang7599/kothar-marketplace](https://github.com/billwang7599/kothar-marketplace). Each entry names its author's own
repo, and Kothar installs from that repo's latest GitHub release, so authors own and update their work without a PR
here. Its README says how to publish and submit a theme or an extension.

## Status

Kothar is in early development, and there's no released build yet. It runs from source on macOS, in a browser tab or
as the desktop app; see [Running from source](CONTRIBUTING.md#running-from-source).

What works today:

- **Engines:** Claude Code, Codex, OpenCode and pi, with saved accounts for each, plus any agent that speaks the
  Agent Client Protocol, added in Settings → Engines → Add ACP agent.
- **Spaces:** a folder becomes a space whose lead agent streams its replies, tool calls and permission requests. Chats
  survive a restart.
- **Quitting or crashing loses no work:** queued messages are saved with their chat and sent when Kothar starts again.
  A worker cut off by a quit or crash stays, and its lead gets a report saying so, so it can carry the worker on or
  start another. If Kothar crashes, the next start stops the engines it left running.
- **Home:** the main chat, a personal assistant that sees every space and can make new ones. It's part of Kothar and
  always on; its role prompt is editable in Settings → Home.
- **Workers:** a lead can hand tasks to workers that run beside it, and extensions start them for their own work. They're
  part of Kothar, not an extension: Settings → Workers sets whether agents may start them, how many one chat runs at
  once (every worker counts, an extension's too; more wait for a slot), and the instructions agents get about them.
  In a space with git folders, each worker gets its **own worktree** on a branch of its own (`kothar-worker/…`), made
  from the space's checkout, so workers running side by side never edit the same files. A space's **Worker setup
  script** (its General tab) runs in each new worktree first, such as `npm ci`; if it fails, the worker stops and its
  lead is told. When the worker reports, its changes (files, lines, commits, uncommitted) come with the report and wait
  for review under the report: **Merge**, **Squash**, **Keep** or **Discard…** (which asks first). Merge commits what
  the worker left uncommitted, and a conflict is undone and reported, the branch left waiting. The lead can do the
  same with `review_worker`, but Merge, Squash and Discard wait for you to approve them on a card. The Changes tab
  lists each worker's checkout beside the space's. One that changed nothing leaves no branch behind. An agent can pass `checkout: "shared"` for a task that
  only reads, and **Own worktree per worker** in Settings → Workers turns it off for every new worker.
- **Extensions that work together:** each session is told what it can use (Kothar's tools and every extension's, one
  line each, made from their names and descriptions) and to combine them on its own, such as handing a deep research
  run to a worker. Workers get the same tools as their lead. The intro is editable in Settings → Prompts.
- **Memory:** every chat has its own. Ask an agent to forget something ("forget the CS343 thing") and its `forget`
  tool removes those messages for good, from the log on disk, their attachments and the chat's memory, after you
  confirm on a card that lists each one (Forget or Cancel). Only its own chat's finished turns can go; a "2 messages
  forgotten" line marks the gap.
- **Sandboxing (macOS):** agents work in a sandboxed work folder, with git folders checked out as worktrees. A repo with no commits yet is used as a plain folder, with its mode, until
  its first commit. Nothing an agent runs can put up a macOS authorization or keychain dialog (such as "Keychain Not
  Found ... Reset To Defaults"): the sandbox blocks the services that draw them, while keychain logins keep working.
- **Folder modes:** each attached folder that isn't a git repo has a mode, picked in the Context panel. **Edit in
  place** (the default) lets the sandbox write in the folder itself, though logins, keys and `.env` files in it still
  ask. **Work on a copy** copies it into the work folder once, and **Copy changes back** shows what the agents changed
  and copies your pick back, refusing to overwrite an original that changed since unless you confirm. **Read only**
  keeps agents out. A folder holding Kothar's own data is always read only. Each session's instructions list every
  folder with its mode, and a refused edit names the setting that would allow it.
- **Permissions:** switches decide what runs without asking.
  **Allowed SSH hosts** let ssh, scp and rsync to servers you trust (with their key) run without asking, set in
  Settings for all spaces or in a space's Permissions tab. A space trusts both lists together; its tab shows Settings'
  hosts read only. A card for a command that reaches one such server offers
  **Always allow <host>**, for this space or all spaces: it approves the command and adds the server to that list.
- **Engine tools:** Settings → Engines lists every built-in tool of Claude Code, pi and OpenCode, each with a switch,
  core ones included. Tools Kothar has its own version of (subagents, background shells, skills, plan modes) and
  tools that act out of Kothar's sight (schedules, notifications, publishing) are off by default; commands, edits,
  reads and searches stay on. The **Engine tools** master switch, and one per engine, turn every built-in tool off,
  leaving the agent only Kothar's tools; your per-tool choices come back when it's on again. What was sent says which
  tools were off for each message. Processes' `start_process` can wake the agent when a command exits, in place of
  Claude Code's Monitor.
- **File links:** a path in a chat that exists in its folders, checkouts or work folder is a link. Click opens it in
  your editor at its line (Settings → Work folder → Open files with: the system's default app, VS Code, Cursor,
  Windsurf, Zed, Sublime Text or a command of your own); right-click opens a terminal at its folder, shows it in
  Finder or copies the path.
- **Images in replies:** `![caption](path)` shows a picture inline when the file is in the chat's folders, checkouts,
  work folder or attachments (an absolute path, `~/…`, `file://…` or relative), served by the core only from there.
  PNG, JPEG, GIF, WebP, SVG, AVIF and BMP up to 25 MB; a missing or too-big file says so inline. A click opens it full
  size, with Open and Show in Finder. Pictures on the web don't load until you click Load image. Agents are told they
  can show images this way, with the path in angle brackets (`![caption](</path with spaces.png>)`); a local path
  with spaces written without them still shows, since the chat adds the brackets before reading the reply. Pictures a tool returns (a browser screenshot, an image the agent read) show as
  thumbnails under its row, saved in the chat's folder (`tool-images/`) so the log keeps only their paths.
- **Math:** replies and extension Markdown render LaTeX with KaTeX, bundled so nothing loads from the web: `$$…$$` and
  `\[…\]` as blocks, `$…$` and `\(…\)` inline. Dollar amounts ("$5 and $10") stay text, a block still streaming stays
  text until it closes, and a formula KaTeX can't read shows its source in red. Notes' editor draws math the same way,
  showing a formula's source while the cursor is in it.
- **Setups, themes, the marketplace,** and the built-in extensions in `extensions/`: Artifacts, Browser, Git,
  Inspector, MCP servers, Memory, Notes, Pins, Plan, Processes, Reconnect, Skills, Deep Research and Account rotation
  (Browser, Git, Pins, Deep Research and Account rotation start off; turn them on in Settings). MCP servers connects
  GitHub, Linear, Notion and other MCP servers to every engine through Kothar, which is their only client, so keys stay in Kothar
  and each call is asked for and recorded. Browser lets agents browse in your own Chrome, with your logins, through
  the Kothar Chrome extension: a tab group per space in your current window, and when a site asks you to sign in, you
  do it there yourself. Pins puts a Pin button
  on each message; the Pinned tab lists the chat's pins and jumps back to one, loading older history if needed. Deep
  Research turns a question into a cited report: a plan you approve, workers that search and read the web, and only
  claims backed by a quote found on their page (a Deep research chip in the composer, or the agent's `deep_research`
  tool). Its Research launcher (⌘⇧D) lists every research in every space and Home, opens the chat each one is in, and
  has New research. Plan adds a **Plan first** chip to the composer: the chat is read only (enforced by the
  sandbox and Kothar's permission answers, on every engine) until you approve the plan the agent hands in, and the
  Plan tab ticks its steps off as the work goes. Inspector shows what Kothar actually sent the engine for each message
  (a folded What was sent row under each of your messages), each part labelled by who it's from, with Edit links to the
  extension prompts behind it; extensions' prompts and tool descriptions are editable on their Settings pages. Its
  Activity tab lists what Kothar and extensions do on their own: model calls, permission answers and the rule behind
  each, workers, retries and account switches.

Not built yet: remote machines, sandboxing outside macOS, a published signed release, and sync.

## Command line

`kothar` drives a running Kothar (the app or `npm run dev`) from a terminal or a script. It isn't in the DMG yet: run
it from a clone with `npm run kothar -- <command>`, or put it on your path with `npm link -w @kothar/cli`.

```sh
kothar list                          # spaces and their workers, with status (--json for scripts)
kothar new ~/code/app --name App     # make a space on a folder; prints its id
kothar send App "fix the failing test" --wait
                                     # stream the reply; exit when the turn ends
kothar status App                    # status, engine, model, queue, what it's waiting for
kothar read App --last 5             # the latest messages (--tools adds tool calls)
kothar stop App                      # stop the running turn
kothar approve App                   # approve the permission request it's waiting on (or deny)
```

A chat is named by its id, the start of one, or a space's name; Home is `home`. `send --wait` exits 0 when the turn
ends, 1 if it failed, 3 when it stops at a permission request or a question (the chat keeps waiting for `approve`,
`deny` or the app), and 4 after `--timeout`. `--approve` approves every request during the wait; leave it off unless
you'd have clicked Approve on all of them anyway. Ctrl+C leaves the turn running.

## Building the Mac app

`npm run package` builds `packages/desktop/release/Kothar-<version>-arm64.dmg` (Apple Silicon). With a Developer ID
certificate in your keychain and a `kothar-notary` notarytool profile, it signs the app and the DMG, notarizes them
and staples the tickets. Without those, it's ad-hoc signed, which runs on the Mac that built it; elsewhere macOS blocks
it until it's opened with right-click → Open. The first line of the build says which. One-time setup, other ways to
give credentials and how to verify: [packages/desktop/README.md](packages/desktop/README.md).

To try a build beside your own Kothar, run it on a throwaway garage:
`KOTHAR_GARAGE=/tmp/k/garage KOTHAR_WORK=/tmp/k/work KOTHAR_USER_DATA=/tmp/k/data KOTHAR_PORT=4391 packages/desktop/release/mac-arm64/Kothar.app/Contents/MacOS/Kothar`.

## License

- **Kothar's core, app and built-in extensions:** [Functional Source License 1.1, Apache 2.0 future licence](LICENSE.md)
  (FSL-1.1-ALv2). You may use, copy, modify and redistribute it for any purpose except a competing commercial
  product or service. Two years after each version is released, that version becomes Apache 2.0.
- **The extension API (`packages/extension-api`):** [MIT](packages/extension-api/LICENSE), so extensions can use any
  licence they like.

Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md).
