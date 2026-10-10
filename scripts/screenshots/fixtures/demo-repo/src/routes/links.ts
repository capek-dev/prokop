import type { LinkStore } from '../store';
import { createSlug, isValidUrl } from '../slug';

interface CreateLinkBody {
  url?: string;
  ttlDays?: number | null;
}

export async function createLink(request: Request, store: LinkStore): Promise<Response> {
  const body = (await request.json().catch(() => null)) as CreateLinkBody | null;
  if (!body?.url || !isValidUrl(body.url)) {
    return Response.json({ error: 'A valid http(s) url is required' }, { status: 400 });
  }

  let slug = createSlug();
  while (store.has(slug)) slug = createSlug();

  const link = store.create(slug, body.url, body.ttlDays ?? null);
  return Response.json(link, { status: 201 });
}

export function linkStats(slug: string, store: LinkStore): Response {
  const link = store.get(slug);
  if (!link) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ slug: link.slug, clicks: link.clicks, expiresAt: link.expiresAt });
}
