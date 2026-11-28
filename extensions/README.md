# Built-in extensions

Each folder here is one extension that ships with Kothar. `<id>/index.ts` default-exports an `Extension` whose `id`
is the folder name, written only against the public [`@kothar/extension-api`](../packages/extension-api/README.md), the
same API community extensions use. The core loads them all at startup. Turn each on or off, and change its settings,
on its page in Settings; switches and settings apply from the next message.

| Folder | Extension | What it does | On by default |
|---|---|---|---|
| `home` | Home | The main chat beside your spaces: an assistant that can list, read and message every space, and make new ones | Always on |
| `artifacts` | Artifacts | Pages, small apps, React components, SVGs, diagrams and documents agents make, kept per space with every version, run in an offline sandbox (library: ⌘⇧A) | Yes |
| `inspector` | Inspector | What Kothar sent the engine each turn, folded under your message, and an Activity tab of what Kothar and extensions did on their own | Yes |
| `mcp` | MCP servers | Connects MCP servers (GitHub, Linear, Notion, a filesystem…) to every engine through Kothar, which keeps the keys and asks for each call | Yes |
| `memory` | Memory | Every chat remembers its whole conversation, as summaries an agent can zoom back into | Yes |
| `notes` | Notes | Markdown notes, global or per space, in a popup (⌘⇧N) with search, pins, tags and `[[links]]`; agents use them only through tools | Yes |
| `plan` | Plan | A Plan first mode: the agent can only read until you approve its plan, then the Plan tab ticks off its steps | Yes |
| `processes` | Processes | Dev servers, watchers and other long-running commands that keep going between messages | Yes |
| `reconnect` | Reconnect | When a turn ends because the connection dropped or the service was down, waits and carries the turn on | Yes |
| `skills` | Skills | Agent Skills (a folder with a `SKILL.md`) on every engine | Yes |
| `account-rotation` | Account rotation | When an account hits its usage limit, switches to the next saved account and carries on | No |
| `browser` | Browser | Agents browse in your own Chrome, with your logins, through the Kothar Chrome extension (`browser/chrome-extension/`) | No |
| `deep-research` | Deep Research | Long, multi-source research that ends in a cited report, every claim backed by a quote from its page | No |
| `git` | Git | A Changes tab: each checkout's branch, its changed files and diffs, and its pull request if `gh` is signed in | No |
| `pins` | Pins | Pin messages and find them again in the Pinned tab | No |

Each extension's settings, prompts and tool descriptions are listed, and editable, on its Settings page.

To change one or add one, see [Writing an extension](../CONTRIBUTING.md#writing-an-extension). Tests sit beside the
code (`*.test.ts`) and use the fake engine only.
