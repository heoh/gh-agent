# npm release path

This project keeps `dist/` out of git, so every npm package must be built from the
current checkout before it is packed or published.

## Maintainer check

Run this from a clean checkout before opening or approving a release PR:

```bash
npm ci
npm run release:check
```

`npm run release:check` is the single local and CI release-readiness path. It
runs formatting checks, tests, a TypeScript build, and `npm pack --dry-run` so the
tarball contents can be inspected before publication.

The package also defines lifecycle guards:

- `prepack` rebuilds `dist/` immediately before `npm pack` creates a tarball.
- `prepublishOnly` runs `release:check` before `npm publish`.

These guards reduce the risk of publishing stale local build output, but
maintainers should still use `npm run release:check` as the explicit review
command because it prints the dry-run package manifest.

## Publication decisions still owned by maintainers

Confirm these before the first public npm publication:

- Package name: `gh-agent` is the current package name. Confirm npm name
  availability and whether a scoped name such as `@heoh/gh-agent` is preferred.
- License: `MIT` is currently declared in `package.json`. Confirm this is the
  intended public license.
- Versioning: `0.1.0` is currently declared. Confirm whether the first public
  release should start at `0.1.0` and use semver from that point.
- Positioning: `TypeScript-based CLI package for gh-agent.` is the current npm
  description. Confirm the public README and npm description before publication.

## GitHub npm publication

Maintainers can publish from GitHub Actions with the manual `Publish package to
npm` workflow. Run it from the `main` branch and enter the exact version already
committed in `package.json`.

The workflow intentionally does not edit `package.json`, create commits, create
tags, or publish from release events. Version bumps should happen in a reviewed
PR first; the manual workflow only validates and publishes the version that is
already on `main`.

The workflow guards the publish step by:

- Failing unless the selected workflow ref is `main`.
- Failing unless the `workflow_dispatch` version input equals
  `package.json#version`.
- Failing if `npm view <package>@<version>` finds that the package version is
  already published.
- Running `npm run release:check` before `npm publish`.

### npm trusted publishing setup

Preferred authentication is npm trusted publishing, not a long-lived npm token.
Configure the package on npmjs.com with this trusted publisher:

- Publisher: GitHub Actions
- Organization or user: `heoh`
- Repository: `gh-agent`
- Workflow filename: `npm-publish.yml`
- Environment name: leave unset unless the workflow is later changed to use a
  matching GitHub environment

The workflow grants `id-token: write` and uses a GitHub-hosted runner with Node
24 so npm can authenticate with OIDC during `npm publish`.

### Token fallback

If trusted publishing is unavailable for the first release, add an `NPM_TOKEN`
repository secret and change the publish step to pass it as `NODE_AUTH_TOKEN`.
Use `npm publish --provenance` for token-based publishing so the package still
gets provenance metadata.

```yaml
- name: Publish to npm
  run: npm publish --provenance
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Keep tag or GitHub Release triggered publication as a separate follow-up. That
flow needs additional decisions for version bump PRs, bump commits, tag ordering,
and duplicate-publish recovery.
