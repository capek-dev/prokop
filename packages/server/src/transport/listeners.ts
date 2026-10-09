// Transport listeners: the main listener can re-bind in place; open connections survive
import type { Server, WebSocketHandler } from 'bun';
import type { WsData } from '@/transport/websocket/bun-adapter';

export interface ListenerEndpoint {
  hostname: string;
  port: number;
  tls?: { cert: string; key: string };
}

export interface ListenerSetOptions {
  fetch(req: Request, server: Server<WsData>): Promise<Response | undefined>;
  websocket: WebSocketHandler<WsData>;
  /** Injected for tests; defaults to Bun.serve. */
  serve?: (endpoint: ListenerEndpoint) => Server<WsData>;
}

export interface ListenerSet {
  start(main: ListenerEndpoint, local: ListenerEndpoint | null): void;
  /**
   * Moves the main listener to a new endpoint. The old listener stops
   * accepting but keeps its open connections; on failure the old endpoint is
   * restored and the error rethrown.
   */
  rebindMain(endpoint: ListenerEndpoint): void;
  main(): ListenerEndpoint | null;
  local(): ListenerEndpoint | null;
  stop(): void;
}

function sameEndpoint(a: ListenerEndpoint | null, b: ListenerEndpoint): boolean {
  return a !== null && a.hostname === b.hostname && a.port === b.port && Boolean(a.tls) === Boolean(b.tls);
}

export function createListenerSet(options: ListenerSetOptions): ListenerSet {
  const serve = options.serve ?? ((endpoint: ListenerEndpoint) => Bun.serve<WsData>({
    port: endpoint.port,
    hostname: endpoint.hostname,
    ...(endpoint.tls && { tls: endpoint.tls }),
    fetch: (req, server) => options.fetch(req, server),
    websocket: options.websocket,
  }));

  let mainServer: Server<WsData> | null = null;
  let mainEndpoint: ListenerEndpoint | null = null;
  let localServer: Server<WsData> | null = null;
  let localEndpoint: ListenerEndpoint | null = null;
  // Listeners replaced by a re-bind; stopped for good at shutdown.
  const retired: Server<WsData>[] = [];

  return {
    start(main, local) {
      mainServer = serve(main);
      mainEndpoint = main;
      if (local) {
        localServer = serve(local);
        localEndpoint = local;
      }
    },

    rebindMain(endpoint) {
      if (sameEndpoint(mainEndpoint, endpoint)) return;
      const previous = mainServer;
      const previousEndpoint = mainEndpoint;
      if (previous) {
        void previous.stop(false);
        retired.push(previous);
      }
      try {
        mainServer = serve(endpoint);
        mainEndpoint = endpoint;
      } catch (error: unknown) {
        if (previousEndpoint) {
          mainServer = serve(previousEndpoint);
          mainEndpoint = previousEndpoint;
        }
        throw error;
      }
    },

    main: () => mainEndpoint,
    local: () => localEndpoint,

    stop() {
      for (const server of [mainServer, localServer, ...retired]) {
        try {
          void server?.stop(true);
        } catch {
          // Already stopped.
        }
      }
      retired.length = 0;
    },
  };
}
