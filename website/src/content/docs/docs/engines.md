---
title: Engines
description: Turn on Claude Code, Codex, OpenCode, pi or any ACP agent, sign in, and manage accounts.
---

An **engine** is a coding-agent CLI that Kothar drives in the background. Kothar never opens an engine's own terminal
UI. You do everything in Kothar.

| Engine | Notes |
|---|---|
| **Claude Code** | Asks before tools run, so permission cards work fully. Reports tokens and cost. |
| **Codex** | Reports tokens, not cost. |
| **OpenCode** | Runs with providers and API keys you add in Kothar. Reports tokens and cost. |
| **pi** | Never asks before running a tool, so only the sandbox limits it. Reports tokens and cost. |
| **Any ACP agent** | Any agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com), added by you. |

## Turn an engine on

Every engine starts off. Open **Settings → Engines**. Each engine shows whether it's installed and signed in. Turn on
the ones you want.

Each chat picks its engine, model and thinking level from its header and message box, between turns.

## Clean sessions

Each message starts a fresh engine session. Kothar gives it what it needs: the chat's memory, its context and the tools
of the extensions that are on. Sessions start clean, so your engine's own plugins, hooks and personal MCP servers
aren't loaded. Add MCP servers in Kothar instead (see [Extensions](/docs/extensions/)).

## Accounts

You can keep more than one account per engine.

1. Open **Settings → Accounts**.
2. Under **Add account**, pick the provider and sign-in method: **Sign in…** opens the engine's sign-in, or **API
   key** saves a key.
3. Pick which account is active for each engine.

Saved accounts stay in Kothar's garage. The **Account rotation** extension (off by default) switches to the next saved
account when one hits its usage limit, and carries on the turn.

## Models

**Settings → Models** lists your preferred models per engine, in order, for each role: chatting, workers, and roles
extensions add, such as Planning (Plan) and Searching (Deep Research). A chat runs its own pick, or else the first
listed model the engine offers.

## Engine tools

**Settings → Engines** also lists each engine's built-in tools, with a switch for each. Tools Kothar has its own version
of (subagents, background shells, skills, plan modes) and tools that act out of Kothar's sight (schedules,
notifications, publishing) start off. Commands, edits, reads and searches stay on.

The **Engine tools** master switch, and one per engine, turn every built-in tool off, so the agent has only Kothar's
tools. Your per-tool choices come back when you turn it on again.

## Add an ACP agent

Any agent that speaks the Agent Client Protocol can run in Kothar, such as Gemini CLI (`gemini --experimental-acp`).

1. Open **Settings → Engines → Add ACP agent**.
2. Fill in:
   - **Name**, such as `Gemini CLI`.
   - **Command**, such as `gemini`.
   - **Arguments**, such as `--experimental-acp`.
   - **Environment**, one `KEY=value` a line, such as an API key.
   - **Writable folders**: folders the agent may write besides the chat's folder while sandboxed, such as its own
     config folder (`~/.gemini`).
3. Turn it on like any other engine.

Kothar starts the agent in each chat's folder, sandboxed. Sign in to the agent with its own CLI first.
