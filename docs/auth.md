# Security & Authentication

## Default: local only, no login

By default, Prokop binds to `127.0.0.1`, so only clients on the same machine can reach it, and they need no login.

Same-machine access is limited to real local clients:

- Requests arriving over loopback must address the server by a loopback name (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`). This blocks DNS-rebinding pages.
- Browser requests must come from the server's own origin, a loopback origin (for example a dev server on another port), or a browser extension. Other websites get `403`.
- Requests from a paired device or with a valid `PROKOPAI_AUTH_TOKEN` skip both checks.

## Using Prokop from another device

1. Choose how other devices reach the server in **Settings → Devices → Remote access** on the computer (or with `prokop remote`, see below).
2. Open Prokop on the other device. It asks the computer for approval and shows a four-digit code.
3. On the computer, a prompt appears: **Allow iPhone (Safari) to use Prokop?** Check that the code matches, then choose **Allow**.

### Remote access

| Setup | What to do |
|-------|------------|
| Same Wi-Fi or LAN | Turn on **Allow devices on my network** (`prokop remote on`) |
| Tailscale, quickest | Turn on **Allow devices on my network**; Tailscale devices can then use the computer's Tailscale IP or name |
| Tailscale with HTTPS (needed for the installable app and notifications on phones) | Click **Set up** next to **Tailscale HTTPS** (`prokop remote tailscale on`). Prokop runs `tailscale serve` and adds `https://<machine>.<tailnet>.ts.net`. If HTTPS is not enabled for your tailnet yet, Prokop shows the Tailscale link to enable it |
| WireGuard, ZeroTier, or another VPN | Turn on **Allow devices on my network** and use the VPN address shown |
| Caddy, nginx, Cloudflare Tunnel, or another proxy | Add the public address, for example `https://prokop.example.com` (`prokop remote add <url>`). Point the proxy at `http://127.0.0.1:8742` |

Changes apply immediately; Prokop re-binds without a restart, and open connections stay up. Turning network access off disconnects devices that connected over the network. Every address still requires pairing, and pairing links and QR codes use the saved addresses.

A same-machine proxy forwards requests with its own hostname. Prokop accepts only hostnames that are saved as addresses, set in `PROKOPAI_ALLOWED_HOSTS`, or the machine's own Tailscale name. Other hostnames get `403` with instructions; this keeps DNS-rebinding pages out.

`PROKOPAI_HOST` fixes the bind address and makes the network toggle read-only.

```bash
prokop remote                     # how other devices can reach Prokop
prokop remote on | off            # listen on your network or only on this computer
prokop remote add <url>           # add a VPN, proxy, or tunnel address
prokop remote remove <url>
prokop remote tailscale on | off  # share over Tailscale HTTPS
```

The device stays paired for 30 days after its last use. No password is typed or stored in a URL.

You can also pair with a one-time code instead:

- Run `prokop pair` on the server. It prints a QR code, a `/pair#code=...` link, and the code.
- Or open **Settings → Devices → Pair a device** in Prokop on the computer.

Scan the QR code, open the link on the other device, or paste the link into **Add Server**. A code works once and expires after 5 minutes.

### Managing devices

**Settings → Devices** on the computer lists waiting requests and paired devices. **Remove** revokes a device and closes its open connections immediately. From the command line:

```bash
prokop auth                     # list paired devices
prokop auth revoke <device-id>  # remove one
```

A paired device can unpair itself in **Settings → Devices**, but only the computer running Prokop can approve, pair, or remove other devices.

### How it works

- Pairing codes and device tokens are stored only as SHA-256 hashes.
- Devices send their token in the `Authorization: Bearer` header. WebSockets use a 60-second, single-use ticket from `POST /api/auth/ws-ticket`, so tokens never appear in socket URLs.
- An approval request waits on a Server-Sent Events stream (`GET /api/auth/requests/:id/events`); the server pushes the decision.
- Requests through a same-machine proxy arrive over loopback, but with the proxy's hostname. They are treated as another device and must pair.

### Turning authentication off

For an isolated network where every device should have access without pairing, set `PROKOPAI_AUTH=off`. Other websites are still refused.

## Legacy shared token

`PROKOPAI_AUTH_TOKEN` still works as a shared password for every device and for scripts:

```bash
# In ~/.prokopai/.env
PROKOPAI_AUTH_TOKEN=your-secret-token
```

Send it as `Authorization: Bearer your-secret-token` or `?token=your-secret-token`. It has no per-device revocation; prefer pairing.

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

When TLS is enabled, the main port keeps serving plain HTTP on loopback only (`http://127.0.0.1:8742` by default) for clients on the same machine, and the TLS listener moves to its own port: the same port when the server binds a specific non-loopback address, or one higher otherwise. TLS on the default `127.0.0.1` bind is reachable only from this machine; set `PROKOPAI_HOST` to share it. For a Tailscale setup where HTTPS keeps port 8742, set `PROKOPAI_HOST` to the machine's Tailscale IP. Disable the local listener with `PROKOPAI_LOCAL_HTTP=false`; override the TLS port with `PROKOPAI_TLS_PORT`.

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
