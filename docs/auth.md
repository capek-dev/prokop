# Security & Authentication

## Default: No Auth

By default, Prokop has **no authentication**. The server binds to `0.0.0.0` and accepts all connections. This is fine for:

- Local development
- Tailscale / VPN networks
- Air-gapped machines

If you expose Prokop to a network you don't fully trust, enable authentication.

## Enabling Authentication

Set a single environment variable:

```bash
# In ~/.prokopai/.env
PROKOPAI_AUTH_TOKEN=your-secret-token
```

Then restart the server:

```bash
prokop restart
```

### How it works

Once `PROKOPAI_AUTH_TOKEN` is set:

- All `/api/*` routes require authentication
- WebSocket connections require authentication
- Public routes (`/`, `/api/health`, `/api/info`, attachment content) remain open

Clients provide the token in one of two ways:

```
Authorization: Bearer your-secret-token
```

Or as a query parameter:

```
?token=your-secret-token
```

### Token security

- Tokens are compared using a **constant-time comparison** to prevent timing attacks
- Tokens are stored as plain environment variables: use appropriate filesystem permissions on `~/.prokopai/.env`

### Checking auth status

```bash
prokop auth
```

Shows whether authentication is enabled and displays a masked token preview.

## TLS (HTTPS)

For connections over untrusted networks, enable TLS. This is required for PWA access on mobile over Tailscale, reverse proxy setups (nginx, Caddy), and any public internet exposure.

Full setup guide including Tailscale HTTPS certificates and reverse proxy configuration: [TLS / HTTPS Guide](./configuration.md#tls-https).

Quick reference:

```bash
# In ~/.prokopai/.env
PROKOPAI_TLS_ENABLED=true
PROKOPAI_TLS_CERT_FILE=/path/to/cert.pem
PROKOPAI_TLS_KEY_FILE=/path/to/key.pem
```

When TLS is enabled, the main port keeps serving plain HTTP on loopback only (`http://127.0.0.1:8742` by default) for clients on the same machine, and the TLS listener moves to its own port: the same port when the server binds a specific non-loopback address, or one higher otherwise. For a Tailscale setup where HTTPS keeps port 8742, set `PROKOPAI_HOST` to the machine's Tailscale IP. Disable the local listener with `PROKOPAI_LOCAL_HTTP=false`; override the TLS port with `PROKOPAI_TLS_PORT`.

## Public Routes

These routes are always accessible without authentication:

| Route | Purpose |
|-------|---------|
| `GET /` | Health check |
| `GET /api/health` | Server health status |
| `GET /api/info` | Server version and info |
| `GET /api/sessions/:id/attachments/:id/content` | Attachment file downloads |

## Permissions

Separate from authentication, Prokop has a **tool permission system**:

- Tools that modify files, run commands, or access the network require user approval
- Permissions are per-workspace and per-tool
- Users can approve once, approve always, or deny
- The "auto-approve" mode allows readonly tools (read-file, glob, grep, etc.) to run without asking

Permissions are stored in the SQLite database and persist across restarts.
