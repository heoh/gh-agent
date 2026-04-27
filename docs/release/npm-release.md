# npm release path

This document is for maintainers who cut npm releases.

`README.md` is the user onboarding guide. This file focuses only on release
operations, validation order, and publish failure handling.

## Canonical release gate

Run from a clean checkout:

```bash
npm ci
npm run release:check
```

`npm run release:check` delegates to `npm run ci:verify` and is the single
release-readiness gate used both locally and in CI.

Current `ci:verify` order:

1. format check
2. README verification
3. lint
4. typecheck
5. tests
6. coverage
7. build
8. `npm pack --dry-run`

Lifecycle guards in `package.json`:

- `prepack`: rebuilds `dist/` right before tarball creation
- `prepublishOnly`: blocks `npm publish` unless release checks pass

## Failure handling

If `release:check` fails, stop and fix before opening/merging a release PR.

### `verify:readme` failure

- Add missing required sections to `README.md`
- Re-run `npm run verify:readme`, then `npm run ci:verify`

### `format/lint/typecheck/test/coverage` failure

- Fix code or tests
- Re-run `npm run ci:verify`

### `build` failure

- Fix TypeScript compile errors
- Re-run `npm run build`, then `npm run ci:verify`

### `npm pack --dry-run` failure

- Check whether the failure is environment-specific (cache/path/permissions)
- Re-run with explicit cache if needed:

```bash
npm_config_cache="$(pwd)/.npm-cache" npm pack --dry-run
```

- If this succeeds while CI fails, fix CI environment parity before publish

### Package contents are unexpected

- Validate `files`, `main`, and `bin` in `package.json`
- Re-run `npm pack --dry-run` and inspect the manifest output again

## GitHub release workflows

### Prepare release PR

Use manual workflow `Prepare release PR` from `main` and provide target SemVer
(e.g. `0.2.0`).

It will:

- validate SemVer and uniqueness
- update `package.json` + `package-lock.json`
- run `npm run ci:verify`
- push `gh-agent/prepare-release-v<version>`
- open/update PR `Prepare release <version>`

Merge this PR before publish.

### Publish reviewed version

Use manual workflow `Publish package to npm` from `main` with the exact version
already committed in `package.json`.

It intentionally does **not** create version bumps, commits, or tags. It only
validates and publishes the reviewed version on `main`.

Publish guardrails:

- ref must be `main`
- workflow input version must equal `package.json#version`
- fail if version already exists on npm
- run `npm run ci:verify` before publish

## npm authentication strategy

Preferred: npm trusted publishing (OIDC), not long-lived npm tokens.

Trusted publisher settings:

- Publisher: GitHub Actions
- Organization/user: `heoh`
- Repository: `gh-agent`
- Workflow file: `npm-publish.yml`
- Environment: unset (unless workflow later requires one)

If trusted publishing is unavailable, use `NPM_TOKEN` temporarily and publish
with provenance:

```yaml
- name: Publish to npm
  run: npm publish --provenance
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
