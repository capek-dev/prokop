import type { LoadedTool } from '@capekai/tool';

/**
 * Harness-owned built-in tool set (S11.5b physical move).
 *
 * The built-in tools live under the Prokop harness directory; adapters that
 * surface the catalog (the tools route seam) read them through this port
 * instead of importing harness internals. The composition profile passes
 * the same set to the resolver plugins explicitly, so only the catalog seam
 * needs the installable form. No installed port means no built-in entries:
 * the catalog lists domain and installed tools only.
 */
export interface BuiltinToolsPort {
  tools(): readonly LoadedTool[];
}

let current: BuiltinToolsPort | null = null;

/** Install (or clear with null) the harness built-in tool set. */
export function installBuiltinToolsPort(port: BuiltinToolsPort | null): void {
  current = port;
}

export function getBuiltinToolsPort(): BuiltinToolsPort | null {
  return current;
}
