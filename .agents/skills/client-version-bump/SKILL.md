---
name: client-version-bump
description: How to bump the web client version in the jean2 monorepo. Load when releasing or versioning client changes.
---

# Client Version Bump (jean2 monorepo)

Procedural guide for bumping the web client version. Server and SDK are versioned separately and must NOT be touched.

## File to update

| File | Format |
|------|--------|
| `packages/client/package.json` | `"version": "X.Y.Z"` |

## Do NOT touch these during a manual bump

- `packages/client/VERSION` - do not update it during a package version change. `package.json` is the build version source.
- `packages/sdk/package.json` — versioned independently
- `packages/server/package.json` — versioned independently
- `packages/sdk/src/version.ts`, `packages/server/src/version.ts` — separate

## Procedure

1. Determine the new version number (e.g. `1.1.0` -> `1.1.1` for a patch).
2. Update `packages/client/package.json` to the new version.
3. Create changelog: `changelogs/client/vX.Y.Z.md`
4. Run `bun run typecheck` to verify nothing broke.

## Changelog format

Follow the style of existing entries in `changelogs/client/`. Sections:

- `### Added` for new features
- `### Changed` for modifications to existing behavior
- `### Fixed` for bug fixes
- `### Removed` for deleted features

Each entry is a bullet starting with **bold summary** followed by a colon and description. Only include sections that have entries. Do NOT use em-dashes anywhere (user preference).

Example:

```markdown
### Changed

- **Structured output visual overhaul**: structured responses now render array items as bordered cards with numbered index badges, use a compact definition-list layout for nested objects, and render markdown syntax in string values.
```

## Verification

After updating, confirm the client version and verify SDK and server are unchanged:

```sh
grep '"version"' packages/client/package.json packages/sdk/package.json packages/server/package.json
```

Do not modify `packages/client/VERSION` as part of the version change.

