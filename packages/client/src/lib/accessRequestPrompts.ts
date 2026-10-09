import type { ProkopaiClient } from '@prokopai/sdk';
import { toast } from 'sonner';

/**
 * Prompts on the server's own machine when another device asks to pair.
 * Driven by the server's `access.changed` event; paired devices are not
 * allowed to list requests, so their check quietly does nothing.
 */
export function subscribeToAccessRequests(client: ProkopaiClient): () => void {
  const shown = new Set<string>();
  let disposed = false;

  const decide = (requestId: string, approve: boolean) => {
    const action = approve ? client.http.access.approve(requestId) : client.http.access.deny(requestId);
    void action.catch((error: unknown) => {
      toast.error('Could not update the request', { description: error instanceof Error ? error.message : String(error) });
    });
  };

  const check = async () => {
    let requests;
    try {
      ({ requests } = await client.http.access.overview());
    } catch {
      return;
    }
    if (disposed) return;
    const pending = new Set(requests.map((request) => request.id));
    for (const id of shown) {
      if (!pending.has(id)) {
        toast.dismiss(`access-request-${id}`);
        shown.delete(id);
      }
    }
    for (const request of requests) {
      if (shown.has(request.id)) continue;
      shown.add(request.id);
      toast(`Allow ${request.label} to use Prokop?`, {
        id: `access-request-${request.id}`,
        description: `Only allow it if that device shows ${request.matchCode}.`,
        duration: Math.max(1000, request.expiresAt - Date.now()),
        action: { label: 'Allow', onClick: () => decide(request.id, true) },
        cancel: { label: 'Deny', onClick: () => decide(request.id, false) },
      });
    }
  };

  const onChanged = () => void check();
  client.on('access.changed', onChanged);
  void check();
  return () => {
    disposed = true;
    client.off('access.changed', onChanged);
    for (const id of shown) toast.dismiss(`access-request-${id}`);
  };
}
