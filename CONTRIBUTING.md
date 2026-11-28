# Contributing

How to run, test and change Kothar. What it does for users is in [README.md](README.md); the website's design system
is in [website/DESIGN.md](website/DESIGN.md).

## Running from source

Needs **Node 26+** and macOS for the full app (core and UI also run on Linux, as in CI; sandboxing is macOS-only).

```sh
npm ci
npm run dev       # core on ws://127.0.0.1:4317, UI on http://localhost:4318, in a browser tab
npm run desktop   # builds the UI, then opens the Electron app
```

`npm run dev` uses your real garage (`~/Library/Application Support/Kothar/`). Keep it apart with
`KOTHAR_GARAGE=/tmp/k/garage KOTHAR_WORK=/tmp/k/work npm run dev`. The desktop app uses the same ports, so quit Kothar
or move the dev copy with `KOTHAR_PORT`, `KOTHAR_UI_PORT`, `KOTHAR_UI_ORIGIN` and `VITE_KOTHAR_CORE_URL`. Other
variables are read in `packages/core/src/main.ts`. The fake engine (scripted replies, no model) appears only with
`KOTHAR_DEV` (set by `npm run dev`) or `KOTHAR_ENGINE=fake`.

Building the Mac app: [README.md](README.md#building-the-mac-app).

## Checks

CI (`.github/workflows/ci.yml`) runs these on Linux for every PR. Run them before you push:

```sh
npm run lint        # oxlint
npm run typecheck   # tsc for core, cli, ui, desktop, extensions and bench
npm test            # vitest, every package and extension
npx vitest run packages/core/src/memory.test.ts   # one file
```

- **Tests never call real models or engines.** Use the fake adapter (`adapters/fake.ts`) and fake machine
  (`adapters/test-machine.ts`). Adapter tests replay recorded output from `adapters/fixtures/<engine>/`.
- About 19 core tests need to run outside a sandbox (they apply the macOS sandbox, run `ps` or write `/tmp`). Inside
  one, such as when a Kothar agent runs them, `needs()` in `packages/core/src/test-env.ts` skips them with a reason; on
  CI they fail instead of skipping.
- UI tests run in jsdom, as `*.test.tsx` beside the components.

## Repo map

```
packages/
  core/            one Node process that drives engines and owns chats (@kothar/core)
    src/main.ts          startup: environment, garage, adapters, extensions
    src/core.ts          wires the core together from the modules beside it
    src/shared.ts        what core and UI share: adapter interface, UI protocol, common types
    src/machine.ts       runs processes, locally and sandboxed
    src/adapters/        one file per engine (claude-code, codex, opencode, pi, acp-agent, fake) and helpers
    src/kothar-mcp.ts    the MCP server every agent gets (zoom, date, spawn_worker, ...)
  ui/              React app (Tailwind, Radix, Motion) over a WebSocket (@kothar/ui)
  desktop/         Electron shell: runs the core, serves the built UI (@kothar/desktop)
  cli/             the kothar command, a WebSocket client of a running core (@kothar/cli)
  extension-api/   public extension types, MIT, types only (@kothar/extension-api)
extensions/<id>/   built-in extensions, each default-exporting an Extension from index.ts
extension-documentation/   docs for extension authors
bench/             memory benchmark (npm run bench:memory, offline) and browser measurements
website/           kothar.sh (Astro + Starlight), its own npm project
```

The core loads every `extensions/<id>/index.ts` at startup; the folder name must match the extension's `id`. Code
changes need a restart; on/off and settings apply from the next message.

## Words

| Word | Meaning |
|---|---|
| Engine | A coding-agent CLI Kothar drives: Claude Code, Codex, OpenCode, pi, or an ACP agent. |
| Adapter | Translates one engine's headless protocol into Kothar's common events. |
| Session | One run of an engine. Every message starts a fresh one; nothing resumes. |
| Chat | An endless conversation owned by Kothar, backed by a series of sessions. |
| Space | A top-level chat with its own folders, files and `AGENTS.md`. Its agent is the **lead**. |
| Worker | A child chat for one task (`spawn_worker`, or `host.createChat({ parentId })`). Its final reply wakes the lead. Core, not an extension. |
| Home | The main chat (id `main`), always on, written as an extension (`extensions/home`, `alwaysOn`). |
| Extension | Adds features through the public API. **Built-in** in `extensions/`; **community** from the Marketplace. |
| Setup | A saved engine, model, thinking level, extensions to leave out and instructions. |
| Garage | Kothar's folder of plain files: settings, accounts, setups, every chat. |
| Machine | Where processes run. Only the local machine exists today. |

A **tool** is something an agent calls. Never call an extension a tool.

## Design rules

1. **Small core.** Machines, sessions, chats (workers included) and an event stream. Everything else is an extension.
2. **Built-in extensions use only the public API.** If it lacks something, add a small generic API change in its own
   PR first, never a private hook.
3. **Extensions never import the core at runtime.** `@kothar/core` may only be a test `devDependency`.
4. **Engines are black boxes, always headless.** Drive them only through their headless protocol and the inputs every
   engine takes (prompt, instructions, MCP servers). Sessions start clean, without the user's plugins or MCP servers.
5. **Engine-specific code stays in its adapter.** Shared types get no engine-only fields.
6. **Adapters never start processes themselves.** They go through a `Machine`.
7. **Kothar owns the context.** Each session sees only what Kothar gives it.
8. **State is plain files** in the garage, not a database.
9. **Pass dependencies in.** Core modules take home folder, environment, clock and machine as arguments; only startup
   reads `os.homedir()`, `process.env` or `Date.now()`.
10. **Checkouts are made in code**, as worktrees in the space's work folder, never by agent instructions.

## Decisions

Choices the next contributor might otherwise undo. Add one line when you make such a choice.

- **Extensions combine through the agent, not code.** Shared building blocks (chats, workers, memory, permissions) go
  in the core. Otherwise give each extension clear tools and let the agent combine them. Use code dependencies
  (`optionalDependencies`, `requires`, `provides`/`host.use`, `host.callTool` with a fallback) only when one extension
  changes another, and never import another extension's files.
- **Ask about capabilities, not owners or ids.** Never check `chat.extension` to decide what a chat can do (that's how
  Home lost the Deep research chip, #376). Use `chat.keepsContext`, `chat.worker`/`chat.parentId` or the space's
  folders, and name shared APIs for what they do (`search`), so a community extension can provide them.
- **Extensions name capabilities, never engine tools** (`replaces: ['background-shell']`). Each adapter maps its own
  tool names (`Adapter.tools`), so engine names stay in adapters.
- **Workers are core** (`chat-lifecycle.ts`, `workers.ts`), so any agent or extension can rely on them. One limit
  counts every running child; over it, `spawn_worker` fails but an extension's worker waits for a slot.
- **Workers get their own worktrees** (`worker-checkouts.ts`) on `kothar-worker/<space>/<id>-<task>`, because shared
  checkouts clashed. Not `kothar/<space>/…`: git can't hold that and `kothar/<space>` at once. Nothing deletes work
  silently: Merge, Squash and Discard are the user's call, and a failed merge is aborted.
- **A restart picks up where Kothar stopped.** A cut-off worker stays idle and its lead is told; queues (`queue.json`)
  run after startup. Leftover processes from an earlier core are stopped only when pid start time and command match
  (`process-records.ts`), so a reused pid is never killed.
- **Deleting a message leaves an `entry.removed` marker** (`message-edits.ts`), so log indexes, which extensions keep
  as keys, never move. Memory ids skip markers and close up; extensions hear `onMessagesRemoved`.
- **`forget` is asked of the user alone** (`userOnly` in `turn.ts`), since an agent that could erase its own history
  could hide mistakes. Only Allow all answers it, as it already allows deleting files.
- **Allow all is a full bypass that folds the other switches** rather than resetting them, so turning it off restores
  them. Read-only folders and read-only turns still hold.
- **Allowed SSH hosts trust one server and key, not ssh** (`ssh-hosts.ts`). Lists add up across chat, space and
  Settings. The check fails closed on anything it can't read.
- **Every engine tool can be switched off, but core tools default on** (`engine-tools.ts`): engines' models are trained
  on them, and Kothar already sees every call. Tools Kothar replaces or can't see default off.
- **Usage lives in `usage.jsonl`, not the log**, so deleting messages never drops what they cost. Costs are the
  engines' own figures; Kothar keeps no price list.
- **Model role ids aren't namespaced** (`model-roles.ts`), so saved `models.<id>` lists need no migration.
- **The CLI's token is taken only on sockets with no `Origin`** (`cli-access.ts`), which browsers always send.
- **The browser is the user's own Chrome**, through the Kothar Chrome extension. A separate Chrome failed Google
  sign-in and meant signing in twice. Don't bring back a second browser mode.
- **Space groups are core sidebar code** because spaces' order is core and the API can't reorder the list.
- **Fresh installs start lean** (Deep Research and Pins off). The Marketplace has its own switch, on by default.
- **A release tag must match `packages/desktop/package.json`'s version.** The workflow never writes it, so what ships
  is a reviewed commit.
- **No Hotrod-rename migrations.** Kothar never shipped as Hotrod. Don't add them back.
- **Auto-update is electron-updater with GitHub Releases** (`packages/desktop/src/updates.ts`), packaged app only. It
  needs every release signed with the same Developer ID and to carry the zip and `latest-mac.yml`; Squirrel.Mac refuses
  anything else.

## Pull requests

- Keep PRs small and about one thing. Run the [checks](#checks) first.
- From a fork, base your PR on `main`. The maintainer's own PRs form a stack (each based on the one below, linked with
  `gh stack link`); if your change builds on one, say so and it will be stacked.
- Change an open PR with a new PR on top rather than amending it, unless it's needed to pass CI.
- [Sign off](#sign-off-dco) every commit.

## Adding an engine adapter

One file in `packages/core/src/adapters/`, implementing `Adapter` from `shared.ts`:

- `detect(machine)`: installed, signed in, and which models.
- `start(machine, options, emit)`: returns `prompt`, `interrupt`, `respond`, `close`, optionally `answer` and `steer`,
  and emits common events (`EngineEvent` in `@kothar/extension-api`). Every tool call carries a common kind (`shell`,
  `edit`, `read`, `search`, `fetch`, `mcp`, `other`).
- Optional: `complete` (one-shot calls, used by Memory) and `accounts`.
- Wanted: `turn.usage` before `turn.completed` with only what the engine reports, and `options.onUsage` from
  `complete`. For running totals, emit the change since the last turn (see Codex).
- Wanted: `tools`, each with a capability and group (`core`, `replaced`, `outside`), so Settings can switch them; emit
  `tools.listed` when a session starts if the engine reports its list.

Rules:

- Start processes only through the `Machine` you're given, never `child_process`.
- Read JSON lines with `onJsonLines` (`adapters/jsonl.ts`), never `readline`: JSON strings may contain U+2028/U+2029.
  Use `rpcClient` (`adapters/rpc.ts`) for JSON-RPC, and `adapters/acp.ts` for ACP engines.
- Label errors with `withKind(error, YOUR_ERRORS)` (`adapters/error-kind.ts`); extensions read the label.
- Take environment and home folder as arguments, like `createPi`.
- Record real output once into `adapters/fixtures/<engine>/*.jsonl` and replay it (see `pi.test.ts`).
- Register it in `registered` in `packages/core/src/main.ts`.

## Writing an extension

[extension-documentation/](extension-documentation/index.md) has the guide and full API reference; the
[examples page](extension-documentation/examples.md) walks through three built-ins.

- A built-in is `extensions/<id>/index.ts`, default-exporting an `Extension` whose `id` is the folder name, with tests
  beside it and a `package.json` named `@kothar/extension-<id>`.
- Import only `@kothar/extension-api` at runtime.
- Reach Kothar's data through the host: `host.storage`/`chatStorage`/`everyChatStorage` for files, `host.home` and
  `host.now()` for home and time, `host.space(chatId).checkouts` and `onSpaceRemoved` for checkouts.
- The core creates and removes checkouts; a repo with no commits isn't checked out yet.
- `host.createChat({ parentId })` children share the space's checkouts when quiet; pass `checkout: 'own'` or
  `'shared'` to choose.
- If the API lacks something, add the smallest generic change to `packages/extension-api/index.ts` and the core in
  its own PR, update `extension-documentation/reference/`, then build on top.

Themes and community extensions live outside this repo: start from
[kothar-sample-mod](https://github.com/billwang7599/kothar-sample-mod) or
[kothar-themes](https://github.com/billwang7599/kothar-themes#make-your-own-theme), then
[submit to the catalog](https://github.com/billwang7599/kothar-marketplace#submit-a-theme-or-mod).

## Old names

Extensions were "mods" and workers were "subagents". These places still read the old names in saved data; don't
remove them, and don't use the old names in new code.

- `chat-store.ts` `renameEntry`: old log entries `subagent.report` and `mod.note`.
- `catalog-check.ts`: catalog entries with `kind: 'mod'`.
- `memory.ts`, `message-edits.ts`, `ui/src/state.ts`: worker reports starting `[subagent "…"]`.
- `workers.ts` `moveWorkersSettings`, `setups.ts`: settings and setups saved while workers were an extension.

## Releasing

Pushing a `v*` tag runs `.github/workflows/release.yml` on a macOS runner: it builds, signs, notarizes and staples
the app and DMG (`packages/desktop/scripts/signing.ts`), checks them with `spctl`, and publishes a GitHub Release with
`Kothar-<version>-arm64.dmg`, an unversioned `Kothar-arm64.dmg` (the website's Download link), their `.sha256`, and
the auto-update files: `Kothar-<version>-arm64-mac.zip`, its `.blockmap` and `latest-mac.yml`. Installed copies read
`latest-mac.yml` from the newest release, so a release without it (or with a wrong hash) updates no one;
`scripts/release-files.ts` checks it before anything is published. A tag with a hyphen makes a pre-release, which
installed copies skip. **Actions → Release → Run workflow** is a dry run that publishes nothing.

### Secrets (one time)

Under Settings → Secrets and variables → Actions. The job names any that are missing.

| Secret | What it is |
|---|---|
| `MACOS_CERTIFICATE_P12` | Developer ID Application certificate and key, base64 `.p12` |
| `MACOS_CERTIFICATE_PASSWORD` | the `.p12`'s export password |
| `APPLE_API_KEY_P8` | App Store Connect API key (Developer role), base64 `.p8` |
| `APPLE_API_KEY_ID` | that key's ID |
| `APPLE_API_ISSUER` | the Issuer ID above the keys list |

Or, instead of the API key, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` (`338W2JWGTX`). Export
the `.p12` from Keychain Access (My Certificates → the Developer ID certificate with its key → Export), download the
`.p8` from App Store Connect → Users and Access → Integrations (only once), and encode each with
`base64 -i <file> | pbcopy`. Delete the local copies afterwards.

### Cutting a release

1. Bump `version` in `packages/desktop/package.json` in a PR and merge it. The tag must match it.
2. `git switch main && git pull && git tag v0.2.0 && git push origin v0.2.0`
3. Watch Actions → Release. If it fails, fix `main` and move the tag (`git tag -f`, `git push -f origin v0.2.0`) or
   bump the version.

### Releasing from your Mac (no secrets)

With the Developer ID certificate and the `kothar-notary` profile on your Mac (`packages/desktop/README.md`):

1. Steps 1 and 2 above (bump, merge, push the tag). Without the secrets the tag's workflow run fails; that's fine.
2. `npm ci && npm run package`. Its first line must say it's signed and notarized.
3. `cd packages/desktop && node scripts/release-files.ts upload v0.2.0`. It checks `latest-mac.yml` against the zip,
   writes the checksums and `Kothar-arm64.dmg`, then creates the release with every file (or adds them to an existing
   one).

## Licence of contributions

Contributions take the licence of the files they change: MIT for `packages/extension-api/`
([LICENSE](packages/extension-api/LICENSE)), FSL-1.1-ALv2 for everything else ([LICENSE.md](LICENSE.md)).

## Sign-off (DCO)

Sign off every commit (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/).
The `Signed-off-by` line must match the commit's author.
