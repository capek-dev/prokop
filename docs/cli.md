# CLI Reference

The Prokop CLI (`prokop`) manages the server daemon, models, and updates.

```
prokop <command> [options]
```

## Daemon Management

### `prokop start`

Start the server as a background daemon.

```
prokop start [-p|--port <port>] [-h|--host <host>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `-p`, `--port` | `8742` | Port to listen on |
| `-h`, `--host` | `0.0.0.0` | Host to bind to |

### `prokop stop`

Stop the running daemon.

### `prokop restart`

Restart the daemon. Accepts the same flags as `start`.

### `prokop status`

Show daemon status (PID, port, host, uptime).

### `prokop logs`

Tail the server log file (`~/.prokopai/server.log`).

### `prokop server`

Start the server in the foreground (for systemd or debugging).

```
prokop server [-p|--port <port>] [-h|--host <host>]
```

## Initialization

### `prokop init`

Complete first-time setup. Uses standard defaults without prompting, starts the daemon, and opens the client.

```
prokop init [options]
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

## Models

### `prokop models sync`

Sync models from the upstream registry.

```
prokop models sync [--override]
```

| Flag | Description |
|------|-------------|
| `--override` | Replace local models.json with upstream (default: merge) |

## Database

### `prokop migrate`

Run pending database migrations.

### `prokop migrate-legacy-data`

Move legacy `~/.jean2` data to `~/.prokopai`, including nested agent home directories and stored workspace paths.

## Updates

### `prokop update`

Update the Prokop binary to the latest version.

```
prokop update [options]
```

| Flag | Description |
|------|-------------|
| `--version <ver>` | Update to a specific version |
| `--force` | Reinstall even if already on latest |
| `--dry-run` | Check for updates without installing |
| `--no-restart` | Don't restart daemon after update |

## Utility

### `prokop open`

Open the built-in client in your browser.

### `prokop auth`

Show authentication status and masked token.

### `prokop version`

Print the current version.

### `prokop help`

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
