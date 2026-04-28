# gh-agent: GitHub Agent

> Bring your agent to GitHub.

GitHub-native agent runner for continuous collaboration workflows.

This is an independent open-source project and is not affiliated with,
endorsed by, or sponsored by GitHub.

## Who This Is For

Use `gh-agent` when you want a dedicated GitHub agent account that wakes on
GitHub signals and works directly in issues, PRs, reviews, and comments.

## Install

```bash
npm install -g gh-agent
```

## Agent Account Setup (Required)

Before first run, prepare a **separate GitHub account** for delegation:

- Use a dedicated GitHub account for `gh-agent`.
- Ensure it can access the target repositories.

## Quick Start

### 1) Initialize once

Run this in the directory you want to use as the agent workspace.

```bash
gh-agent init
```

`gh-agent init` ensures a GitHub Project named `gh-agent` exists on the
authenticated account (creates it if missing).

In a terminal, it also lets you
choose which agent CLI to use for the workspace.

For non-interactive setup, you can pass either a built-in preset or a custom
command directly:

```bash
gh-agent init --agent codex
gh-agent init --agent-command 'my-agent "$GH_AGENT_PROMPT"'
```

When using a custom command:

- `$GH_AGENT_PROMPT` contains the generated session prompt
- `$GH_AGENT_HOME` points at the workspace root

### 2) Run the loop

```bash
gh-agent run
```

Stop with `Ctrl+C`.

### 3) Optional diagnostics

```bash
gh-agent status
```

Use this only for quick operational checks (lock, mode, auth, signal summary).

## How It Works

`gh-agent run` keeps a foreground loop running in your workspace.
It monitors GitHub signals (notifications and project updates), and wakes only
when there are unread messages or remaining tasks.
When work is needed, it runs an agent session and then returns to waiting.

## Commands

- User-facing: `gh-agent init`, `gh-agent run`, `gh-agent status`
- Agent-internal: `gh-agent mailbox ...`, `gh-agent task ...`

For full command details, run `gh-agent --help`.

## Troubleshooting

### Auth is broken or wrong account is connected

Symptom: auth errors persist, or `gh-agent` keeps using the wrong GitHub account.

From your agent workspace directory, reset local workspace auth state:

> Warning: This removes local `gh-agent` workspace state in the current directory.

```bash
rm -rf .gh-agent/
gh-agent init
```

### `run` says another instance is already running

Symptom: lock conflict from another active runner.

- Check with `gh-agent status`.
- Stop the other active `gh-agent run` process, then run again.
- Only if no other `gh-agent run` process exists, remove stale lock:

```bash
rm -f .gh-agent/lock
gh-agent run
```

## License

Apache-2.0
