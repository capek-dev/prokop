---
name: legacy-data-migration-safety
description: Safely migrate Jean2 user data to Prokopai without stale paths, empty databases, or partial activation.
---

## When to Use

Use when changing or reviewing the `jean2` to `prokopai` data-directory migration, startup path resolution, SQLite migration, or recovery of a partially moved installation.

## Procedure

1. Trace normal startup configuration resolution, including persisted absolute `databasePath` values and environment overrides. Do not validate migration only by inspecting moved files.
2. Refuse migration while any Jean2 or Prokop process can still write the source database. Require a clean WAL checkpoint before copying.
3. Stage the database and configuration in the destination. Rewrite persisted paths in the staged configuration and workspace records before activation.
4. Validate the staged SQLite database with `PRAGMA integrity_check`, and compare fingerprints or equivalent content identity before and after path rewrites. Keep the original as a timestamped backup.
5. Activate only after staged validation and startup-path verification succeed. On any failure, leave the source usable and provide a recovery path for an already-moved directory with stale configuration.
6. Preserve workspace-directory compatibility: `.prokopai/` wins, legacy `.jean2/` is used only when canonical is absent, and a missing pair defaults to `.prokopai/`.

## Pitfalls

- Moving the database without rewriting an absolute `databasePath` causes startup to create a new empty database at the stale path.
- A test that sets `PROKOPAI_DATABASE_PATH` can bypass the normal `config.json` startup boundary and miss this regression.
- Copying an active SQLite database without checkpointing can omit WAL state or produce an inconsistent destination.
- Do not delete the source before the destination opens and validates through the real startup resolver.

## Verification

- Use disposable directories and exercise the ordinary config-file startup path, not only an environment override.
- Cover active-process refusal, WAL checkpointing, integrity and fingerprint validation, rollback, stale-config repair, and missing-database behavior with focused migration tests.
- Inspect the final migration diff and confirm no live `~/.jean2` or `~/.prokopai` data was touched.
