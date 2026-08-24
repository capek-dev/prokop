# CLI Reference

The Prokop CLI (`prokopai`) manages the server daemon, tools, models, and updates.

```
prokopai <command> [options]
```

## Daemon Management

### `prokopai start`

Start the server as a background daemon.

```
prokopai start [-p|--port <port>] [-h|--host <host>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-p`, `--port` | `8742` | Port to listen on |
| `-h`, `--host` | `0.0.0.0` | Host to bind to |

### `prokopai stop`

Stop the running daemon.

### `prokopai restart`

Restart the daemon. Accepts the same flags as `start`.

### `prokopai status`

Show daemon status (PID, port, host, uptime).

### `prokopai logs`

Tail the server log file (`~/.prokopai/server.log`).

### `prokopai server`

Start the server in the foreground (for systemd or debugging).

```
prokopai server [-p|--port <port>] [-h|--host <host>]
```

## Initialization

### `prokopai init`

Complete first-time setup. Uses standard defaults without prompting, starts the daemon, and opens the client.

```
prokopai init [options]
```

| Flag | Description |
|------|-------------|
| `--db-path <path>` | Custom database path |
| `--tools-path <path>` | Custom tools directory |
| `--run-migrations` | Run schema migrations (default) |
| `--no-migrations` | Skip schema migrations |
| `--install-preconfigs` | Install default preconfigs (default) |
| `--no-preconfigs` | Skip preconfig installation |
| `--force` | Force re-initialization |

## Optional tool extensions

The baseline tools used by bundled agents ship in the binary. These commands manage optional integrations only and are not part of installation.

### `prokopai tools list`

List available and installed tools.

```
prokopai tools list [options]
```

| Flag | Description |
|------|-------------|
| `--installed` | Only show installed tools |
| `--extensions` | Show extension and env config details |
| `--json` | JSON output |

### `prokopai tools install`

Install tools. Interactive if no names provided.

```
prokopai tools install [names...] [options]
```

| Flag | Description |
|------|-------------|
| `--all` | Install all tools |
| `--force` | Reinstall even if already installed |

### `prokopai tools update`

Update installed tools to the latest version.

```
prokopai tools update [names...] [--dry-run]
```

### `prokopai tools remove`

Remove installed tools.

```
prokopai tools remove [names...] [--all]
```

### `prokopai tools outdated`

Check for available updates.

## Models

### `prokopai models sync`

Sync models from the upstream registry.

```
prokopai models sync [--override]
```

| Flag | Description |
|------|-------------|
| `--override` | Replace local models.json with upstream (default: merge) |

## Database

### `prokopai migrate`

Run pending database migrations.

## Updates

### `prokopai update`

Update the Prokop binary to the latest version.

```
prokopai update [options]
```

| Flag | Description |
|------|-------------|
| `--version <ver>` | Update to a specific version |
| `--force` | Reinstall even if already on latest |
| `--dry-run` | Check for updates without installing |
| `--no-restart` | Don't restart daemon after update |

## Utility

### `prokopai open`

Open the built-in client in your browser.

### `prokopai auth`

Show authentication status and masked token.

### `prokopai version`

Print the current version.

### `prokopai help`

Print the full help text.

## Environment

All server behavior is configured via environment variables. See [Configuration](./configuration.md) for the complete reference.

- `~/.prokopai/.env`: Server reads this automatically on startup
- System environment variables take precedence over `.env`
- Changes to `.env` require a server restart

## Configuration Files

| File | Purpose |
|------|---------|
| `~/.prokopai/config.json` | Server configuration (port, host, paths) |
| `~/.prokopai/models.json` | Model registry (providers and models) |
| `~/.prokopai/.env` | Environment variables and API keys |
| `~/.prokopai/AGENTS.md` | Global agent instructions |
| `~/.prokopai/server.pid` | Daemon PID file |
| `~/.prokopai/server.log` | Server log file |
