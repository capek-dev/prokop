import { LinkStore } from './store';
import { createLink, linkStats } from './routes/links';
import { redirect } from './routes/redirect';

export function createServer(store = new LinkStore()) {
  return {
    store,
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);

      if (request.method === 'POST' && pathname === '/api/links') {
        return createLink(request, store);
      }

      const stats = pathname.match(/^\/api\/links\/([\w-]+)\/stats$/);
      if (request.method === 'GET' && stats) {
        return linkStats(stats[1]!, store);
      }

      const slug = pathname.match(/^\/([\w-]+)$/);
      if (request.method === 'GET' && slug) {
        return redirect(slug[1]!, store);
      }

      return new Response('Not found', { status: 404 });
    },
  };
}

if (import.meta.main) {
  const server = Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: createServer().fetch });
  console.log(`linkshelf listening on ${server.url}`);
}
