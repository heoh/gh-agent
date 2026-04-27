# Contributing

Thanks for contributing to `gh-agent`. This guide is designed so first-time and
returning contributors can open a PR with minimal friction.

## Before You Start

1. Make sure you have `Node.js >= 20` installed:

```bash
node -v
```

Local minimum is Node `>=20`; CI currently runs Node `24`.

2. Install dependencies from the repository root:

```bash
npm ci
```

## Local CLI Install (Optional)

If you want to run this repo as a local `gh-agent` CLI while developing:

```bash
npm install
npm run build
npm link
```

## Choose Contribution Type

- `Bug Report`: Use the `Bug Report` issue template for reproducible defects or regressions.
- `Feature Request`: Use the `Feature Request` issue template for new behavior or changes.
- `General`: Use the `General` issue template for docs, infra, ambiguous work, or design notes.
- `Small fix or docs-only PR`: You can open a direct PR for small, obvious fixes. For larger changes, open an issue first so scope is clear.

## Step-by-Step Workflow

1. Fork this repository on GitHub and clone your fork locally.
2. Create a feature branch from `main`.

```bash
git checkout -b <type>/<short-description>
```

3. Make your changes.
4. Run local verification before pushing:

- For docs-only changes, run:

```bash
npm run format:check
```

- For any code, test, or config behavior change, run:

```bash
npm run ci:verify
```

5. Commit and push your branch to your fork.
6. Open a pull request against `main`.

## Pull Request Expectations

- Use `.github/pull_request_template.md` for every implementation PR.
- Fill out `Background`, `Changes`, `Tests`, `Risks`, and `Follow-ups` clearly.
- Keep the `Tests` checklist aligned with commands you actually ran.
- If you skip any listed check, select `Not run` and explain why in the PR body.
- Keep PRs focused and small enough for practical review.
- Respond to review comments with follow-up commits (or clear rationale when no change is needed).

## CI Expectations

The `Release readiness` workflow runs on pull requests and on pushes to `main`.
It runs `npm ci` and then `npm run ci:verify`.

`npm run ci:verify` enforces:

- format check
- lint
- typecheck
- coverage run
- `npm pack --dry-run`

Release workflows (`Prepare release PR`, `Publish package to npm`) reuse the same
verification gate. For release details, see
`docs/release/npm-release.md`.

## Command Reference

If you need to run checks individually, these scripts are available:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run pack:dry-run
npm run ci:verify
```

For release-specific checks and publication flow, see
`docs/release/npm-release.md`.
