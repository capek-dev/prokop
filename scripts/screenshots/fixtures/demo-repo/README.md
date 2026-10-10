# linkshelf

Small self-hosted link shortener. Bun, no dependencies.

```bash
bun run dev     # http://localhost:3000
bun test
```

## API

- `POST /api/links` with `{ "url": "https://...", "ttlDays": 7 }` creates a short link
- `GET /:slug` redirects to the target
- `GET /api/links/:slug/stats` returns click counts
