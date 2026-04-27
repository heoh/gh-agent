# gh-agent

`gh-agent` is a TypeScript CLI for running a GitHub mailbox + project task loop
from your local workspace.

It helps you:

- read and triage unread GitHub notifications (`mailbox`)
- promote important threads to GitHub Project cards
- manage task cards (`task`) in a consistent CLI flow
- run a foreground automation loop (`run`) with workspace state tracking

## Requirements

- Node.js `>=20`
- GitHub CLI (`gh`) installed and available on `PATH`
- A GitHub account with access to GitHub Projects (v2)

## Install

Install globally from npm after publication:

```bash
npm install -g gh-agent
```

For local development from this repository:

```bash
npm ci
npm run build
npm run start -- --help
```

## Quick Start

1. Initialize your workspace:

```bash
gh-agent init
```

2. Check current status:

```bash
gh-agent status
```

3. Inspect unread notifications:

```bash
gh-agent mailbox list --limit 20
```

4. Promote a thread into your project:

```bash
gh-agent mailbox promote <thread-id> --status ready
```

5. Start the foreground loop:

```bash
gh-agent run
```

## Authentication

`gh-agent` uses GitHub CLI authentication under the hood.

If authentication is missing or expired, run:

```bash
gh auth login --hostname github.com --scopes project
```

If you need to refresh scopes later:

```bash
gh auth refresh --hostname github.com --scopes project
```

## Core Commands

### Workspace

- `gh-agent init`: Initialize `.gh-agent` workspace config and project metadata.
- `gh-agent status`: Print auth, project, and runtime status summary.
- `gh-agent run`: Start the foreground orchestration loop.

### Mailbox

- `gh-agent mailbox list [--limit <n>]`
- `gh-agent mailbox show <threadId>`
- `gh-agent mailbox promote <threadId...> [--status ready|waiting]`
- `gh-agent mailbox ready <threadId...>`
- `gh-agent mailbox wait <threadId...>`
- `gh-agent mailbox ignore <threadId...>`

### Tasks

- `gh-agent task list [--status ...] [--priority ...] [--type ...] [--execution-class ...]`
- `gh-agent task show <taskId>`
- `gh-agent task create --title ... --status ... [options]`
- `gh-agent task update <taskId> [options]`
- `gh-agent task ready <taskId...>`
- `gh-agent task doing <taskId...>`
- `gh-agent task wait <taskId...>`
- `gh-agent task done <taskId...>`

## Troubleshooting

### `gh-agent` reports authentication errors

- Verify `gh auth status --hostname github.com`
- Re-run `gh auth login` with `--scopes project`

### `init` says project configuration is missing or invalid

- Re-run `gh-agent init` to rebuild required field mappings
- Ensure your GitHub account can read/write the target project

### `npm run ci:verify` fails before release

- Run checks one by one to isolate the failure:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
```

## Documentation

- Contributor workflow: `CONTRIBUTING.md`
- npm release process: `docs/release/npm-release.md`
- Architecture notes: `docs/architecture/`
- Specs: `docs/specs/`

## License

MIT
