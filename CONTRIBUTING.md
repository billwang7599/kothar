# Contributing

Thanks for helping with Kothar. This page covers how to run, test and change the code. To build an extension or theme
outside this repo, see [Writing an extension](#writing-an-extension).

## Running from source

You need **Node 26 or later** (`engines` in `package.json`) and macOS for the full app. The core and UI also run on
Linux, which is what CI uses, but sandboxing is macOS-only.

```sh
npm ci
npm run dev       # core on ws://127.0.0.1:4317, UI on http://localhost:4318 (Vite), in a browser tab
npm run desktop   # builds the UI, then opens the Electron app
```

`npm run dev` uses your real garage (`~/Library/Application Support/Kothar/`). To keep your own chats and settings out
of it, point it at a scratch folder:

```sh
KOTHAR_GARAGE=/tmp/k/garage KOTHAR_WORK=/tmp/k/work npm run dev
```

The desktop app uses the same core port, so quit Kothar first, or move the dev copy to other ports with
`KOTHAR_PORT`, `KOTHAR_UI_PORT`, `KOTHAR_UI_ORIGIN` (the UI's address) and `VITE_KOTHAR_CORE_URL` (the core's
WebSocket address, read by the UI).

Other variables the core reads (`packages/core/src/main.ts`): `KOTHAR_PORT` (core port, default 4317),
`KOTHAR_UI_ORIGIN`, `KOTHAR_TOKEN`, `KOTHAR_ENGINE`, `KOTHAR_MARKETPLACE_URL`, `KOTHAR_GITHUB_TOKEN` and `KOTHAR_DEV`.
The UI's Vite port is `KOTHAR_UI_PORT` (default 4318). The fake engine (scripted replies, no model) is offered only when
`KOTHAR_DEV` is set, which `npm run dev` does, or `KOTHAR_ENGINE=fake`; the desktop app never lists it.

To build the Mac app, see [Building the Mac app](README.md#building-the-mac-app).

## Checks

CI (`.github/workflows/ci.yml`) runs these on every PR, on Linux. Run them before you push:

```sh
npm run lint        # oxlint
npm run typecheck   # tsc for core, ui, desktop, extensions and bench
npm test            # vitest, every package and extension
npx vitest run packages/core/src/memory.test.ts   # one file
```

- **Tests never call real models or engines.** Use the fake adapter (`packages/core/src/adapters/fake.ts`), which
  replays scripted sessions, and the fake machine in `adapters/test-machine.ts`. Adapter tests replay recorded engine
  output from `adapters/fixtures/<engine>/`.
- **About 19 tests skip when you run them inside a sandbox.** Some core tests apply Kothar's macOS sandbox, run `ps`
  or write `/tmp`. Inside a sandbox already (for example, when a Kothar agent runs the tests), those can't work, so
  `needs()` in `packages/core/src/test-env.ts` skips them and prints the reason. Run on a normal Mac terminal, they all
  run. On CI they fail instead of skipping, so a broken runner can't pass quietly. The macOS-only tests skip on Linux.
- UI tests run in jsdom. They are `*.test.tsx` files next to the components.

## Repo map

```
packages/
  core/            the core: one Node process that drives engines and owns chats (@kothar/core)
    src/main.ts          startup: reads the environment, finds the garage, registers adapters, loads extensions
    src/core.ts          wires the core together; its parts are the modules beside it (chat-store, turn, protocol,
                         instructions, memory, checkouts, extension-host, settings, setups, ...)
    src/shared.ts        what core and UI share: the adapter interface, the UI protocol, common types
    src/machine.ts       runs processes, locally and sandboxed
    src/folder-modes.ts  how agents may write in attached folders: the sandbox, permission answers and instructions
    src/folder-copies.ts folders set to Work on a copy: the copy, its changes and Copy changes back
    src/adapters/        one file per engine (claude-code, codex, opencode, pi, fake) and their helpers
    src/kothar-mcp.ts    the MCP server Kothar gives every agent (zoom, date, spawn_worker, ...)
  ui/              React app (Tailwind, Radix, Motion), talking to the core over a WebSocket (@kothar/ui)
  desktop/         Electron shell that runs the core and serves the built UI (@kothar/desktop)
  extension-api/   @kothar/extension-api: the public extension types, MIT, types only
extensions/<id>/   the built-in extensions, each default-exporting an Extension from index.ts
extension-documentation/   the extension author docs
bench/             memory benchmark (npm run bench:memory; offline, on the fake engine)
```

The core loads every `extensions/<id>/index.ts` at startup, and the folder name must match the extension's `id`.
Changing an extension's code needs a restart; switching it on or off and its settings apply from the next message.

## Words

Use the names the code uses:

| Word | Meaning |
|---|---|
| Engine | A coding-agent CLI Kothar drives: Claude Code, Codex, OpenCode, pi. |
| Adapter | Translates one engine's headless protocol into Kothar's common events. One per engine. |
| Session | One run of an engine. Each message starts a fresh one; nothing resumes. |
| Chat | An endless conversation owned by Kothar, backed by a series of sessions. |
| Space | A top-level chat with its own folders, files and `AGENTS.md`. Its agent is the **lead**. |
| Worker | A chat started below another for one task: by its agent with `spawn_worker`, or by an extension with `host.createChat({ parentId })`. Its final reply wakes the lead (or, quiet, goes to the extension). Part of the core, set in Settings → Workers. |
| Home | The main chat (id `main`): a personal assistant that sees every space. Part of Kothar and always on, though written as an extension (`extensions/home`, `alwaysOn`). |
| Extension | Adds features to Kothar through the public extension API. **Built-in** ones ship in `extensions/`; **community** ones install from the marketplace. |
| Setup | A saved choice for a kind of job: engine, model, thinking level, extensions to leave out, instructions. |
| Garage | Kothar's own folder: settings, accounts, setups and every chat. Plain files (JSON, JSONL, Markdown). |
| Machine | Where processes run. Only the local machine exists today. |

A **tool** is something an agent calls (run a command, edit a file, an MCP tool). Never call an extension a tool.

## Design rules

1. **Small core.** The core is machines, sessions, chats (workers included) and an event stream. Everything else is an
   extension.
2. **Built-in extensions use only the public extension API** (`@kothar/extension-api`). If one needs something the
   API lacks, add a small, generic API change in its own PR first, never a private hook.
3. **Extensions never import the core at runtime.** `@kothar/core` may only be a `devDependency` of an extension, for
   its tests.
4. **Engines are black boxes, always run headless.** Kothar drives them only through their headless protocol and the
   inputs every engine takes (prompt, instructions, MCP servers), never through their own plugins or hooks. Sessions
   start clean, without the user's engine plugins or MCP servers.
5. **Engine-specific code stays in its adapter.** Shared types get no engine-only fields.
6. **Adapters never start processes themselves.** They go through a `Machine`, so the same adapter can run anywhere.
7. **Kothar owns the context.** Each session sees what Kothar gives it: instructions, memory, context items.
8. **State is plain files** in the garage, not a database.
9. **Pass dependencies in.** Core modules take the home folder, environment, clock and machine as arguments rather
   than reading `os.homedir()`, `process.env` or `Date.now()` themselves. Only startup code reads them.

## Decisions

Why some things are the way they are. Add one when you make a choice the next contributor would otherwise undo.

- **No Hotrod-rename migrations.** Kothar never shipped as Hotrod, and the one garage from then has moved, so the
  rename's migration code (garage and Electron folder moves, `HOTROD_` fallbacks, `hotrod.*` keys, old settings and
  chat keys, `Mod*` aliases and `ChatDetail.mod`) was deleted rather than kept forever. Don't add it back.
- **Fresh installs start lean.** Deep Research and Pins are off by default; a switch saved in `settings.json` wins, so
  only installs that never touched them change. The fake engine is for development and tests (`KOTHAR_DEV`), not the app.

- **Home is part of Kothar, but still an extension.** The main chat and spaces are what Kothar is, so Home is always on:
  it has no switch, isn't listed under Built-in extensions, and its page (its editable role prompt) sits under
  Options as Settings → Home. A saved `home: { enabled: false }` from when it could be turned off is dropped at
  startup. Its code stays in `extensions/home` on the public extension API, marked `alwaysOn: true`, rather than
  moving into core: it's the one extension that proves the API can own a chat, and moving it would grow the core for
  no new behaviour. `alwaysOn` is generic (any built-in extension can set it; a community extension's is ignored), and
  an always-on extension can still be left out per setup, except of a chat it owns.
- **Model roles are declared by extensions, and their ids aren't namespaced.** Kothar keeps only Chat and Workers;
  Plan declares `planning` and Deep Research `searching` (`Extension.modelRoles`, `packages/core/src/model-roles.ts`).
  A role's id is the key its list is saved under (`settings.json` `models.<id>`), so keeping the old ids means users'
  saved Planning and Searching lists work as they were, with no migration. Namespacing (`plan:planning`) would have
  needed one, and would make community roles uglier for no gain while clashes are rare: the first extension to declare
  an id keeps it and a later one's is shown as an error on its page. A role's list is kept while its extension is off
  (hidden in Settings, not run), so turning it back on restores the user's picks.
- **A release tag must match the version; the workflow never sets it.** The release workflow stops if `v0.2.0` is
  pushed while `packages/desktop/package.json` says `0.1.0`, instead of writing the version from the tag. That way the
  version that ships is the one in a reviewed commit on `main`, and a local `npm run package` of that commit builds the
  same DMG name. In `scripts/signing.ts`, notary credentials in the environment win over the `kothar-notary` profile
  (they're set on purpose, and checking the profile signs in to Apple, which a CI runner without one would wait on), and
  `KOTHAR_REQUIRE_NOTARIZED=1` turns "signed but NOT notarized" into a stop, so CI can't publish a DMG that warns.
- **Workers are part of the core, not an extension.** They were the Workers extension, but it was only a switch and two
  settings over things that were already core: child chats (`chat-lifecycle.ts`) and the `spawn_worker` tool
  (`kothar-mcp.ts`). As an extension it invited other extensions to depend on it (Deep Research greyed out a setting
  without it), though what they need, child chats, never depended on it. Every agent and every extension can now count
  on workers, so no extension declares a dependency to start one. Settings → Workers (`workers.ts`) keeps what the
  extension had: **Let agents start workers** (the old switch, so turning it off still takes `spawn_worker` and its
  instructions away), **Max running per chat**, and the instructions as an editable prompt. A setup keeps its chats
  from starting workers with `workers: false` (older setups' `extensionsOff: ['workers']` reads as that).
- **One limit counts every worker.** Max running per chat counts every running child of a chat, `spawn_worker`'s and
  extensions' (quiet ones too), so an extension can't run past the user's limit. Over it, `spawn_worker` fails, so the
  agent knows and can wait or stop one; an extension's worker waits for a slot instead, because the extension's work
  (a research run) should finish, not fail. That's also why the switch for agents is separate from the limit: a
  limit of 0 would leave an extension's workers waiting forever.
- **A restart picks up where Kothar stopped.** A worker is there for one task, so one still saved at start was stopped
  by a quit or crash (`chat-lifecycle.ts` `restartedWorker`). It isn't deleted: if it was cut off, it stays idle with
  its log and its lead gets a report saying so, so the lead decides whether to carry it on (`send_message`) or start
  another. A worker whose turn had ended well reports as it would have and goes; one whose report the lead has already
  read goes; a quiet one goes, since its extension owns its work. Queues are saved in each chat's `queue.json`
  (`queue-store.ts`) and run only after startup (`core.resume()`, called by `startCore` once the server is up),
  because sessions need the MCP address. The core records each process group it spawns in
  `<garage>/processes.json` (`process-records.ts`); after taking `kothar.lock`, a start stops an earlier core's groups
  that are still running, but only when the leader's start time (to the second, from `ps`) and command still match, so
  a reused pid is never killed. Records from this process are skipped, since a restart in place or a test keeps a
  sibling core running. A normal quit and SIGINT/SIGTERM/SIGHUP already stop every session (`closeOnSignals`, the
  desktop app's `before-quit`).
- **The agent combines extensions; code rarely does.** Each session's "What you can use" section (`core-prompts.ts`)
  lists what the chat can use, made from extensions' metadata, and tells the agent to combine them. Workers get their
  lead's extension tools. An extension a worker uses may start workers one level below that worker (only there), so a
  worker's deep research doesn't wait for the slot the worker itself holds.
- **How extensions work together: five rules.** Other people write extensions and can't change the core, so these keep
  every extension combinable without code linking them:
  1. **Shared building blocks go in the core.** If two or more extensions need the same thing (chats, workers,
     sessions, events, memory, permissions), it's core, reached through the public API. That's why workers moved in.
  2. **Prefer the agent combining tools over code dependencies.** Give each extension clear tools; the agent is told
     what it can use and combines them (a deep research run inside a worker needs no code in either).
  3. **Code dependencies only when one extension changes how another looks or behaves.** Then use
     `optionalDependencies`, `requires`, a setting's `requires`, or a capability (`provides`, `host.provide`,
     `host.use`). Never import another extension's files. Calling another extension's tool with `host.callTool`, with
     a fallback when it's off, is fine.
  4. **Never check `chat.extension` to decide what a chat can do.** It says who owns a chat, not what it can do; that
     check is how Home lost the Deep research chip (#376). Ask about the capability: `chat.keepsContext` (has folders,
     files and a work folder: false for Home), `chat.worker` / `chat.parentId`, or the space's folders.
  5. **Depend on capabilities, not ids.** Name a shared API for what it does (`search`, `research`), so a community
     extension can provide it instead of a built-in one.

- **The browser is the user's own Chrome, and only that.** Agents browse through the Kothar Chrome extension, in a
  blue tab group per space in the window the user last used, opened in the background so nothing takes focus. When a
  site wants a sign-in, `ask_user_in_browser` brings the agent's tab forward and the user signs in there themselves.
  Kothar used to run a Chrome of its own per space (its own profile, a headless browser, a plain window for signing
  in, idle close), and before that copies of the user's profiles. Copies failed Google sign-in (Google signs out of a
  copied profile), and a separate profile meant signing in to everything twice, in a browser that sites treat as
  automated. The user's decision: "just use my chrome. if it needs sign in, i just sign in using my own chrome." So
  that mode and its code (`chromium.ts`, `profiles.ts`, `space-browser.ts`, `endpoint.ts`, `cdp.ts`) are gone, and its
  profile folders are deleted when the extension starts. Don't bring back a second browser mode. If the extension
  isn't connected, the tools fail at once and say how to set it up.

- **Allow all is a full bypass, and it folds the other switches rather than resetting them.** The user asked for
  "approve everything": while `allowAll` is on, the chat runs with no sandbox (`editsAnywhere` counts it) and the core
  approves every permission request (`ALLOW_ALL_RULE` in `permissions.ts`), logins, keys, `.env` files and Kothar's
  saved accounts included, and extensions' policies can't overrule it. Two things still hold, because they aren't
  questions the user is asked: a folder the user set to Read only, and a read-only turn. It layers like every switch
  (chat, chats above, Settings → Work folder), so a chat can turn it off under a space that has it on. While it's on,
  the Permissions tab and Settings show only it, with the others folded away: their picks stay saved and come back
  unchanged when it's turned off, so turning it on is never a one-way door. The chat header shows an amber **Allow
  all** chip, like Edits anywhere, so an unguarded chat is easy to spot.

- **Allowed SSH hosts trust a server and one key, not ssh in general.** A user who copies files from the same server
  all day shouldn't need Allow all or Run network commands without asking. `sshHosts` is a list, and unlike a switch the
  layers add up: a chat trusts its own list, its space's and Settings' together (`sshHostsOf`), so a host allowed for
  all spaces runs in a space with a list of its own too, and a space can't take it away. The Permissions tab lists the
  hosts from above read only, marked where they're set. `trustsSshHosts` (`ssh-hosts.ts`) approves a
  sandboxed command only when every ssh, scp, sftp and rsync in it reaches a listed host, any `-i` key is the one listed
  for it, and nothing else in it would ask (another network command, any other login or key). It reads the command with
  `read-only.ts`'s parser, which now expands plain `$NAME`/`${NAME}` set earlier in the same command (`K=~/.ssh/k`,
  `for f in a b; do ...`), because that's how agents write these commands. It fails closed: options that run programs or
  reach other hosts (`-o ProxyCommand`, `-J`, `-S`, `-F` other than `~/.ssh/config`, forwarding), rsync daemons, `$(...)`,
  unset or splitting variables and `FOO=bar ssh` all ask as before. Unsandboxed chats still ask for every command. The
  macOS sandbox only limits writes, so a trusted ssh reaches the network and reads its key; it can't add a new host to
  `~/.ssh/known_hosts` or open a ControlMaster socket there.
- **A permission card can add its SSH server to Allowed SSH hosts, for the space or for all spaces.** Both scopes were
  there already (Settings' list and a chat's own), so no new one was added. The core works out the server when the
  request comes in (`trustableSshHost`, `sshHostOf` in `ssh-hosts.ts`) and logs it on the request as `sshHost`, so the
  card needs no shell parsing and survives a restart. It is offered only when listing that one server (with its one
  `-i` key, written from `~/`, and no user, so any login on it) is exactly what the command needs: it re-runs
  `trustsSshHosts` with only that entry, and offers nothing where the list wouldn't count (unsandboxed, commands
  asking, a read-only turn, Allow all). Since the lists add up, **This space** adds just the server to the space's
  own list and **All spaces** just to Settings'; nothing is copied, and no other list changes. A worker's card writes
  to its space.
- **A folded group's spaces pop out on hover; an unfolded one shows nothing.** Unfolded, its spaces are already in
  the sidebar, so a popup would only repeat them. The whole group row, ⋯ included, is the hover target, so the pointer
  can cross the ⋯ to the popup, which opens just past the sidebar's edge (Radix HoverCard, 200 ms in, 150 ms out). A
  space picked there leaves its group folded, since folding it was the user's choice; opening a hidden space any other
  way (search, a shortcut, a link) still unfolds its group. No popup mid-drag, with the ⋯ menu open or while renaming.

- **Extensions can open a chat for the user (`host.openChat`).** Deep Research's Research popup lists runs from every
  space and Home and opens the chat each lives in. Nothing in the public API could move the window to another chat, and
  a private hook would break rule 2, so `openChat(chatId, { entry, panel })` is a generic host call (use `panels`): it
  selects the chat as the sidebar does, scrolls to a log entry (the same reveal the ⌘O palette uses) and can open one
  of the extension's own docks beside it. It moves the user, so it's only for answering their click in the
  extension's panel or card, never unasked. The list itself reads `index.json` in Deep Research's storage, one short
  summary per run kept up to date on every save, so it never opens run records full of findings or reports; runs saved
  before the index are added the first time the list draws.

- **Space groups are core sidebar code, not an extension.** Groups are visual folders of spaces in the left sidebar.
  They live where spaces are ordered: a space's `group` sits in its chat.json beside `pinned` and `order`, `chat.move`
  places it, and the groups themselves (names and order) are `<garage>/groups.json`. The public extension API can add
  launchers, panels and message actions but can't add rows to the spaces list or reorder it, and spaces' order is
  already core (`moveChat`), so an extension would need a private hook. A group changes nothing about its spaces'
  context, folders, memory or work folder. Pinned spaces show in Pinned, not in their group, but keep their group, so
  Unpin puts them back in it. Deleting a group never deletes a space: they go below the ungrouped ones. Which groups are
  collapsed is a window preference (localStorage `kothar.collapsedGroups`), like folded workers; opening a space in a
  collapsed group (search, a link) expands it, and ⌘↑/↓ and ⌘1–9 skip spaces hidden in collapsed groups.

- **Deleting a message really deletes it, and leaves a marker where it was.** Users delete messages to take back
  something they pasted by mistake, such as a secret, so hiding it isn't enough: `message-edits.ts` replaces each
  removed entry with `{ type: 'entry.removed', at }` and writes `log.jsonl` again whole (a temp file renamed over it),
  and deletes the attachments and tool pictures no other message uses. The log otherwise stays append-only.
  - **Why a marker, not a shorter log:** an entry's index is the key extensions keep (`ExtensionMessage.entry`, a
    pin), and the UI pages the log by index. With markers no index moves and none is ever used twice, so a pin can't
    jump to another message. Edit and Undo cut the log back the same way, with markers from the message on.
  - **Memory ids close up:** memory numbers only real messages (`messagesOf` skips markers), because the summary tree
    needs ids with no gaps (blocks of 2^k from 0). So ids after a deleted message move down. The core tells extensions
    with `onMessagesRemoved` (`firstMessage`, the first id that moved), and Memory drops every summary that reaches it,
    in both modes' files, and writes them again. Summaries name their last message's time, so ones left from a delete
    made while Memory was off are dropped when it next opens the chat. The Inspector forgets the prompts sent since
    the deleted message, as they quoted it.
  - **What stays:** files the agent changed (said in the UI), a worker's view of its lead frozen at its launch
    (`parent-view.md`), and the turn's start and end markers of a deleted reply, so the chat doesn't read as quit
    mid-turn. Only a stopped chat can be edited or undone; a delete can't touch the turn that runs.

- **Every engine tool can be switched from Kothar.** Kothar wants to see and control as much of what an agent does as
  it can, so each engine's built-in tools are listed in Settings → Engines → Tools (`engine-tools.ts`), each with a
  switch, core ones included, under two master switches (**Engine tools** for every engine, and one per engine). A
  master off leaves the agent only MCP tools: Kothar's and extensions'. The per-tool choices stay saved underneath.
- **Core tools stay on by default.** Commands, edits, reads and searches are what an engine is good at: its model was
  trained on those exact tools, and Kothar's own MCP versions would make every engine worse and the same. Kothar
  already sees every call (`tool.started`) and answers every permission request, so leaving them on costs no control.
  Tools are grouped by what they do, not by engine: **core** (on), **replaced** (off while Kothar or an extension has
  its own version: workers for subagents, Processes for background shells, Skills, Plan), and **outside** (off: they
  act where Kothar can't see, stop or log them, such as schedules, notifications and publishing). A tool an engine
  reports that its adapter doesn't know yet is on, marked new, and asks before each use.
- **Extensions name capabilities, never engine tools.** An extension says what it stands in for with
  `replaces: ['background-shell']`; each adapter maps its own tool names to those capabilities (`Adapter.tools`), so
  engine names stay inside adapters and a community extension turns off the right tool on every engine.
- **With every tool off, a few things stay.** Claude Code keeps `ToolSearch`, which it may need to load deferred MCP
  tools (Kothar's among them); pi uses `--no-builtin-tools`, not `--no-tools`, which would drop MCP too; OpenCode turns
  each built-in off by name, never `*`, which would match `kothar_*` as well.
- **forget always asks, and nothing can answer for you.** An agent's `forget` tool erases messages for good (the
  same removal as Delete: `entry.removed` in place, `log.jsonl` rewritten, files only they used deleted, Memory told
  through `onMessagesRemoved`). Its card is asked of the user alone (`userOnly` in turn.ts): Allow all, automatic
  permission answers, extensions' policies and read-only turns never answer it. An agent that could quietly erase its
  own history could hide its mistakes, and a prompt injection could use it to wipe evidence; there's no undo once the
  text is gone. It acts only on its own chat's finished turns (no other chat, not a parent's frozen view), reads ids as
  the session was shown them (`chat.seen`), so a second forget in the same turn still names the right messages, and
  keeps only ids in the log: the call's `reason` is dropped as it's logged, and the card keeps its count once the
  messages are gone. It's a core tool beside `list_chats`, not Memory's, because it works with Memory off too and uses
  the core's delete; no private hook was needed.

## Pull requests

- **Keep PRs small** and about one thing. Run the [checks](#checks) first.
- **Stack PRs while a stack is open.** Open PRs usually form a stack: each PR's base is the branch of the PR below it,
  so they merge bottom-up without conflicts. Start your branch from the top of the open stack (`gh pr list`), base
  your PR on that branch, and link it into the stack with `gh stack link <PR numbers...>`.
- **Change an open PR with a new PR on top** rather than amending it, unless the fix is needed for it to pass CI.
- **Sign off every commit** (see [Sign-off](#sign-off-dco)).

## Adding an engine adapter

An adapter is one file in `packages/core/src/adapters/`, implementing `Adapter` from `packages/core/src/shared.ts`:

- `detect(machine)`: whether the engine is installed and signed in, and the models it offers.
- `start(machine, options, emit)`: starts a session and returns `prompt`, `interrupt`, `respond` (to a permission
  request), `close`, and optionally `answer` and `steer`. It reports what happens through `emit` as common events
  (`EngineEvent` in `@kothar/extension-api`): `turn.started`, `text.delta`, `tool.started`, `permission.requested`,
  `turn.completed` and so on. Every tool call carries a common kind (`shell`, `edit`, `read`, `search`, `fetch`,
  `mcp`, `other`).
- Optional: `complete` (one-shot model calls, used by Memory) and `accounts` (sign in, sign out, API keys).
- Optional but wanted: `tools`, the engine's built-in tools, each with a shared capability and a group (`core`,
  `replaced`, `outside`; see [Decisions](#decisions)). With it, `start` gets `options.tools` (`off` and `on`, by the
  engine's names) and `options.noTools` (every built-in off, MCP tools kept), and Settings → Engines → Tools lists the
  engine. Emit `tools.listed` with the engine's own list when a session starts, if the engine says it, so tools the
  adapter doesn't know show up as new. Without `tools`, the engine's tools can't be switched (Codex today).

Rules and helpers:

- **Start processes only through the `Machine`** you're given (`machine.spawn`, `machine.run`), never with
  `child_process`.
- **Read JSON lines with `onJsonLines`** (`adapters/jsonl.ts`), never Node's `readline`: JSON strings may contain
  U+2028 and U+2029, which `readline` treats as line ends. For JSON-RPC over stdio use `rpcClient` (`adapters/rpc.ts`);
  for engines that speak the Agent Client Protocol, start from `adapters/acp.ts` (OpenCode uses it).
- **Label errors** with `withKind(error, YOUR_ERRORS)` from `adapters/error-kind.ts`. Wording every engine shares lives
  there; put your engine's own wording in an `EngineErrors` object in your adapter. Extensions such as Reconnect read
  the label instead of parsing error text.
- **Build it from what it's given.** Follow `createPi` and the others: the adapter takes the user's environment and
  home folder as arguments.
- **Test with fixtures.** Record real engine output once into `adapters/fixtures/<engine>/*.jsonl` and replay it
  through the fake machine (see `pi.test.ts`). Tests never run the real engine.
- Register it in `registered` in `packages/core/src/main.ts`.

## Writing an extension

[extension-documentation/](extension-documentation/index.md) covers using, building and publishing extensions, with
the full API reference. Built-in extensions in `extensions/` follow the same API and are good examples; the
[examples page](extension-documentation/examples.md) walks through three of them.

- A built-in extension is `extensions/<id>/index.ts`, default-exporting an `Extension` whose `id` is the folder name,
  with tests beside it and a `package.json` named `@kothar/extension-<id>`.
- It imports types from `@kothar/extension-api` only. `@kothar/core` is allowed as a test `devDependency`, never at
  runtime.
- It reaches Kothar's data through the host, not around it:
  - Use `host.storage`, `host.chatStorage` or `host.everyChatStorage` for files, not paths worked out from the
    garage.
  - Use `host.home` and `host.now()` for the home folder and the time, not `node:os` or `Date.now()`.
  - Use `host.space(chatId).checkouts` and `onSpaceRemoved` for a space's checkouts.
- The core creates every checkout and removes them when a space is deleted (design rule 10). Optional cleanup of merged
  work belongs to an extension; see `extensions/git/cleanup.ts`. A repo with no commits yet isn't checked out: it's a
  plain folder with its mode until its first commit (`hasNoCommits` in `checkouts.ts`), so `checkouts` lacks it.
- If the API lacks something, add the smallest generic change to `packages/extension-api/index.ts` and the core in its
  own PR, update `extension-documentation/reference/`, then build the extension on top.

Community extensions and themes don't live in this repo; see
[Adding a theme or extension to the marketplace](#adding-a-theme-or-extension-to-the-marketplace).

## Old names and why they still work

Extensions were called mods (community ones "aftermarket" mods), and workers were subagents. Saved files and published
extensions from then must keep working, so a few places still accept the old names. Don't remove these, and don't use
the old names in new code. (Kothar was also called Hotrod. That rename's migrations, of the garage, `HOTROD_` variables,
`hotrod.*` UI preferences, old settings keys and the deprecated `Mod*` type aliases, were removed before the first
release, once the only garage from then had moved.)

| Where | What it keeps working |
|---|---|
| `packages/core/src/chat-store.ts` (`renameEntry`) | Old log entries (`subagent.report`, `mod.note`) read under today's types. Logs are append-only history, so these stay. |
| `packages/core/src/catalog-check.ts` (catalog `kind: 'mod'`) | Marketplace catalogs written when extensions were mods. |
| `packages/core/src/memory.ts`, `packages/ui/src/state.ts` (`[subagent "…"]`) | Worker reports in old chat logs. |
| `packages/core/src/workers.ts` (`moveWorkersSettings`), `packages/core/src/setups.ts` (`extensionsOff: ['workers']`) | Settings and setups saved while workers were an extension. |

## Releasing

Pushing a `v*` tag runs `.github/workflows/release.yml`. On a macOS runner it builds Kothar, signs it with the
Developer ID certificate, notarizes and staples the app and the DMG (`packages/desktop/scripts/signing.ts`, the same code
as `npm run package` on your Mac), checks both with `spctl` (the job fails unless both say `Notarized Developer ID`), and
publishes a GitHub Release with `Kothar-<version>-arm64.dmg`, its `.sha256` and notes generated from the merged PRs. A
tag with a hyphen (`v0.2.0-beta.1`) makes a pre-release.

**Dry run:** Actions → Release → Run workflow builds, signs, notarizes and verifies any branch, keeps the DMG as a
workflow artifact for a week, and publishes nothing.

### Secrets (one time)

Add these under Settings → Secrets and variables → Actions → New repository secret. The job checks them first and
names any that are missing; it never prints their values.

| Secret | What it is |
|---|---|
| `MACOS_CERTIFICATE_P12` | the Developer ID Application certificate and its private key, as a base64 `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | the password you gave the `.p12` when exporting it |
| `APPLE_API_KEY_P8` | an App Store Connect API key, the base64 of its `.p8` file |
| `APPLE_API_KEY_ID` | that key's ID (10 characters) |
| `APPLE_API_ISSUER` | the Issuer ID shown above the keys list (a UUID) |

Instead of the three API key secrets you can add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`
(`338W2JWGTX`). If both sets are there, the API key is used.

**The `.p12`:** in Keychain Access → login → My Certificates, expand "Developer ID Application: …", select the
certificate (with its private key underneath), right-click → Export 2 items… → Personal Information Exchange (.p12), and
set a password. Then:

```sh
base64 -i DeveloperID.p12 | pbcopy   # paste as MACOS_CERTIFICATE_P12
```

**The API key:** at App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys, generate a
key with the **Developer** role (an Account Holder or Admin has to have requested API access once). Download the
`AuthKey_<ID>.p8`: Apple lets you download it only once. Note the Key ID and the Issuer ID. Then:

```sh
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy   # paste as APPLE_API_KEY_P8
```

Delete the local `.p12` and `.p8` copies once they're saved as secrets (keep the `.p12` backup you made when you
created the certificate).

### Cutting a release

The tag has to match `version` in `packages/desktop/package.json`, which names the DMG and the app; the job stops if it
doesn't, and never changes the version itself. So:

1. Bump `version` in `packages/desktop/package.json` in a PR, and merge it.
2. Tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. Watch Actions → Release. Notarization takes a few minutes per file. When it's done, the release is on the Releases
   page.

If the job fails after the tag is pushed, fix it on `main`, then move the tag (`git tag -f v0.2.0 && git push -f origin
v0.2.0`) or bump to the next version.

## Licence of contributions

Contributions are licensed under the licence of the files they change (inbound = outbound):

- `packages/extension-api/`: MIT ([packages/extension-api/LICENSE](packages/extension-api/LICENSE)).
- Everything else: FSL-1.1-ALv2 ([LICENSE.md](LICENSE.md)).

## Adding a theme or extension to the marketplace

Themes and community extensions don't live in this repo. Publish yours from a repo of your own and submit it to the
catalog: see [kothar-marketplace](https://github.com/billwang7599/kothar-marketplace#submit-a-theme-or-extension). The
theme format and a template are in [kothar-themes](https://github.com/billwang7599/kothar-themes#make-your-own-theme);
an extension starts from the template [kothar-sample-mod](https://github.com/billwang7599/kothar-sample-mod).

## Sign-off (DCO)

Sign off every commit to certify the [Developer Certificate of Origin](https://developercertificate.org/), that you
wrote the change or otherwise have the right to submit it under that licence:

```sh
git commit -s
```

This adds a `Signed-off-by: Your Name <you@example.com>` line, which must match the commit's author.
