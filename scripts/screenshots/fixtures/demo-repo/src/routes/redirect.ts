import type { LinkStore } from '../store';

export function redirect(slug: string, store: LinkStore): Response {
  const link = store.get(slug);
  if (!link) {
    return new Response('Link not found', { status: 404 });
  }

  store.recordClick(slug);
  return Response.redirect(link.url, 302);
}
