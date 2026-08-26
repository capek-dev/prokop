---
name: package-release-procedure
description: How to trigger server, tools, and browser releases in the Jean2 monorepo.
---

# Package Release Procedure

## When to Use

Use when triggering or reviewing server, tool, or browser releases in the Jean2 monorepo.

## Version Contract

- `package.json` is the only build, tag, and package version source.
- `VERSION` files record the latest published version and are updated only by announcement pull requests.
- Manual version bumps touch only the relevant `package.json` files.
- Never bump a version unless the user explicitly asks.

## Release Workflows

| Workflow | Output | Trigger |
|---|---|---|
| `release.yml` | Server binaries with embedded web client, plus tools | Manual workflow dispatch |
| `release-browser.yml` | Browser extension | Manual workflow dispatch |

The web client is private and embedded in server binaries. There is no separate client npm publishing workflow.

## Procedure

### Server

1. Bump `packages/server/package.json` only when explicitly requested.
2. Scan the client, including `.storybook/`, for stale workspace package aliases after package renames. Storybook mocks are typechecked by the production client build.
3. Confirm `packages/client` builds successfully with the release command because its `dist` tree is embedded in every server binary with Bun `--asset`.
4. Trigger `release.yml` with `release_server: true` and `release_all_tools: false`.
5. Confirm all platform binaries build, include the client assets, and upload before the announcement job runs.

### Tools

1. Bump each changed tool package only when explicitly requested.
2. Trigger `release.yml` with `release_server: false` and `release_all_tools: true`.
3. The matrix checks all tools and skips releases that already exist.

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
- Tools and browser: verify expected asset names and announcement jobs.
- Merge announcement pull requests so `VERSION` files match published releases.
