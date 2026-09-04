---
name: package-release-procedure
description: How to trigger server and browser releases in the Prokop monorepo.
---

# Package Release Procedure

## When to Use

Use when triggering or reviewing server or browser releases in the Prokop monorepo.

## Version Contract

- `package.json` is the only build, tag, and package version source.
- `VERSION` files record the latest published version and are updated only by announcement pull requests.
- Manual version bumps touch only the relevant `package.json` files.
- Never bump a version unless the user explicitly asks.
- When release notes are consolidated, keep one server changelog for the shipped product. Put new capabilities under `Added`, and do not create a parallel client changelog.

## Release Workflows

| Workflow | Output | Trigger |
|---|---|---|
| `release.yml` | Server binaries with embedded web client | Manual workflow dispatch |
| `release-browser.yml` | Browser extension | Manual workflow dispatch |

The web client is private and embedded in server binaries. There is no separate client npm publishing workflow. Prokop does not build or publish external tools.

## Procedure

### Server

1. Bump `packages/server/package.json` only when explicitly requested.
2. Scan the client, including `.storybook/`, for stale workspace package aliases after package renames. Storybook mocks are typechecked by the production client build.
3. Confirm `packages/client` builds successfully with the release command because its `dist` tree is embedded in every server binary with Bun `--asset`.
4. Trigger `release.yml` with `release_server: true`.
5. Confirm all platform binaries build, include the client assets, and upload before the announcement job runs.

### Browser Extension

1. Bump the browser manifest and package version only when explicitly requested.
2. Trigger `release-browser.yml` with `release_browser: true`.
3. Confirm the release assets and VERSION announcement pull request.

## Pitfalls

- Never manually edit a `VERSION` file before release.
- Use `force: true` only to intentionally recreate an existing release and move its tag.
- Do not publish `@prokopai/client` to npm. The production web client ships inside server binaries.
- Do not publish or upload before validation passes.
- Release jobs must build from the release tag commit, not a mutable branch tip.

## Verification

- Server: verify each binary includes `dist/index.html` and JavaScript assets before upload.
- Browser: verify expected asset names and the announcement job.
- Merge announcement pull requests so `VERSION` files match published releases.
