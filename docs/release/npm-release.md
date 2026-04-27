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

## Future GitHub release automation

Manual workflow or release-tag based publishing should call the same
`npm run release:check` path before `npm publish`. Keep that automation in a
separate PR so the first step remains reviewable: define and verify the package
that would be published.

Recommended follow-up options:

- Manual workflow: `workflow_dispatch` accepts a version input, validates the
  working tree, runs `npm version`, runs `npm run release:check`, and publishes.
- Tag workflow: a `vX.Y.Z` tag or GitHub Release triggers validation that the tag
  matches `package.json`, then runs `npm run release:check` and publishes.
- Combined workflow: support both entry points, with a guard that prevents
  publishing the same package version twice.
