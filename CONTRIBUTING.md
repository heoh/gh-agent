# Contributing

This repository uses a single CI quality gate for pull requests and `main` pushes.
Local changes should pass the same checks before opening a PR.

## Local Setup

```bash
npm ci
```

## Local Verification

Run these commands when working on implementation changes:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run build
npm run ci:verify
```

`npm run release:check` remains available and delegates to `npm run ci:verify`.

## CI Expectations

The `Release readiness` workflow runs on pull requests and on pushes to `main`.
The workflow executes `npm run ci:verify`, which enforces:

- format check
- lint
- typecheck
- tests
- coverage run
- build
- `npm pack --dry-run`

The release automation workflows (`Prepare release PR`, `Publish package to npm`)
reuse the same verification gate before creating a release PR or publishing.
