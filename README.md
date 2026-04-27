# gh-agent

`gh-agent` is a local CLI for running an agent workflow around GitHub issues,
pull requests, notifications, and a GitHub Projects board.

It is designed for contributors who want an agent to wake up from GitHub
signals, triage work, track tasks on a project board, and leave collaboration
history in GitHub. It is not a hosted service, GitHub App, or remote multi-agent
platform. The CLI runs in your local workspace and uses your local GitHub CLI
authentication.

## Requirements

- Node.js 20 or newer.
- Git.
- GitHub CLI (`gh`) installed and available on `PATH`.
- A GitHub account with access to the repositories you want the agent to work
  with.
- GitHub CLI authentication with repository, notification, and Projects access.

The workspace initializer can start `gh auth login` for you. If your current
GitHub CLI token does not include Projects access, it will ask GitHub CLI to
refresh the token with the required project scope.

## Installation

Install the CLI globally from npm:

```bash
npm install -g gh-agent
```

Then confirm the command is available:

```bash
gh-agent --help
```

For source checkouts, use the repository scripts instead:

```bash
npm ci
npm run build
node dist/cli.js --help
```

## First Workspace

Create a dedicated workspace directory. The workspace stores local runtime
state, GitHub CLI auth state for the agent, and repository clones used during
agent work.

```bash
mkdir my-agent-workspace
cd my-agent-workspace
gh-agent init
```

`gh-agent init` creates the local workspace files, ensures a GitHub Project
named `gh-agent` exists for task tracking, and prepares the command that will be
used to launch agent sessions.

After initialization, check the workspace:

```bash
gh-agent status
```

Start the foreground polling loop:

```bash
gh-agent run
```

The loop polls GitHub notifications and the configured GitHub Project. When it
finds unread mailbox items or actionable task cards, it starts an agent session
using the configured command. Stop the loop with `Ctrl-C`.

## Day-to-Day Commands

Mailbox commands inspect unread GitHub notification threads:

```bash
gh-agent mailbox list
gh-agent mailbox show <threadId>
gh-agent mailbox promote <threadId>
gh-agent mailbox ignore <threadId>
```

Use `promote` when a notification should become tracked work on the GitHub
Project. Use `ignore` when the thread does not need agent follow-up.

Task commands inspect and update project cards:

```bash
gh-agent task list
gh-agent task show <taskId>
gh-agent task create --title "Write release notes" --status ready --type execution
gh-agent task doing <taskId>
gh-agent task wait <taskId>
gh-agent task done <taskId>
```

Only task cards in `Ready` or `Doing` count as actionable work for the polling
loop. `Waiting` cards remain tracked but do not wake the agent by themselves.

## Workspace Layout

A workspace looks like this:

```text
agent-workspace/
  .gh-agent/
    config.json
    gh-config/
    session_state.json
    wake_decisions.jsonl
    lock
  work/
```

`.gh-agent/` contains local runtime state. It is workspace-specific and should
not be treated as shared project documentation.

`work/` is the agent's execution area. The agent can clone repositories there,
create branches, run tests, and keep temporary files while handling GitHub work.
GitHub issues, pull requests, comments, commits, and project cards remain the
shared source of truth for collaboration.

## GitHub Project Workflow

`gh-agent` uses a personal GitHub Projects board as the task board. During
initialization, the CLI creates or reuses a project named `gh-agent` and ensures
the fields needed by the commands exist.

The standard status flow is:

- `Ready`: work can start now.
- `Doing`: work is actively being handled in the current session.
- `Waiting`: work is blocked on review, CI, user input, or another condition.
- `Done`: the current agent responsibility is complete.

Mailbox notifications are not automatically task cards. The agent or user
decides whether a thread should be ignored, answered directly, or promoted into
tracked work.

## Agent Execution

The workspace config contains the command used to launch an agent session. The
default command is intended for Codex:

```json
{
  "defaultAgentCommand": "codex exec --full-auto \"$prompt\"",
  "heavyAgentCommand": null
}
```

At runtime, `gh-agent run` builds a session prompt from mailbox and task context
and passes it through the `prompt` environment variable. If `heavyAgentCommand`
is unset, heavy work falls back to the default command.

## Current Boundaries

The current release focuses on a local, GitHub-native workflow:

- No hosted daemon or managed cloud service.
- No GitHub App installation flow.
- No separate web UI.
- No distributed coordination between multiple running agents.
- GitHub Notifications and GitHub Projects are the primary coordination
  surfaces.
- Local state under `.gh-agent/` is operational state, not a replacement for
  GitHub issues, pull requests, reviews, and comments.

## Release and Development Docs

- Contributor workflow:
  [CONTRIBUTING.md](https://github.com/heoh/gh-agent/blob/main/CONTRIBUTING.md)
- CLI behavior:
  [docs/specs/cli.md](https://github.com/heoh/gh-agent/blob/main/docs/specs/cli.md)
- Workspace layout:
  [docs/specs/workspace-layout.md](https://github.com/heoh/gh-agent/blob/main/docs/specs/workspace-layout.md)
- Runtime model:
  [docs/architecture/runtime-model.md](https://github.com/heoh/gh-agent/blob/main/docs/architecture/runtime-model.md)
- npm release path:
  [docs/release/npm-release.md](https://github.com/heoh/gh-agent/blob/main/docs/release/npm-release.md)
