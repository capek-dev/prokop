/**
 * Event-loop stall diagnostics (`PROKOPAI_PERF_DIAGNOSTICS=true`).
 *
 * A 100ms interval measures how late it fires. When the loop was blocked
 * longer than the threshold, it logs the stall with what was running:
 * in-flight HTTP requests and the breadcrumbs recorded during the stall
 * (HTTP routes, WebSocket messages, outgoing events), including synchronous
 * handler segments that took 10ms or more. Every recorder is a no-op when
 * diagnostics are off.
 */

import { readEnvInt } from '@/infrastructure/runtime/env-compat';
import { isPerfDiagnosticsEnabled } from './perf';

const TICK_MS = 100;
const DEFAULT_STALL_MS = 50;
const SLOW_SEGMENT_MS = 10;
const MAX_BREADCRUMBS = 64;

interface Breadcrumb {
  label: string;
  at: number;
  count: number;
  /** Longest synchronous segment for this label, when measured. */
  syncMs: number;
}

export interface StallMonitorOptions {
  thresholdMs?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export interface StallMonitor {
  /** Breadcrumb for an entry point or event; consecutive repeats are counted. */
  record(label: string, syncMs?: number): void;
  /** Marks a long-running activity in flight until the returned function runs. */
  begin(label: string): () => void;
  /** Measures the synchronous part of `run` (up to its first await). */
  sync<T>(label: string, run: () => T): T;
  /** Checks the time since the previous tick and reports a stall. */
  tick(): void;
}

const ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Route-like label: ids collapse so repeated requests read as one breadcrumb. */
export function activityLabel(prefix: string, path: string): string {
  return `${prefix} ${path.replace(ID_PATTERN, ':id')}`;
}

export function createStallMonitor(options: StallMonitorOptions = {}): StallMonitor {
  const thresholdMs = options.thresholdMs ?? DEFAULT_STALL_MS;
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? ((line: string) => console.log(line));
  const breadcrumbs: Breadcrumb[] = [];
  const inFlight = new Map<number, { label: string; since: number }>();
  let nextId = 0;
  // The first tick only sets the baseline, so startup work is not reported.
  let lastTick: number | null = null;

  function record(label: string, syncMs = 0): void {
    const at = now();
    const last = breadcrumbs.at(-1);
    if (last?.label === label) {
      last.count++;
      last.at = at;
      last.syncMs = Math.max(last.syncMs, syncMs);
      return;
    }
    breadcrumbs.push({ label, at, count: 1, syncMs });
    if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
  }

  function describe(crumb: Breadcrumb): string {
    const parts = [crumb.label];
    if (crumb.count > 1) parts.push(`x${crumb.count}`);
    if (crumb.syncMs >= SLOW_SEGMENT_MS) parts.push(`(sync ${crumb.syncMs.toFixed(0)}ms)`);
    return parts.join(' ');
  }

  return {
    record,

    begin(label) {
      const id = nextId++;
      inFlight.set(id, { label, since: now() });
      return () => inFlight.delete(id);
    },

    sync(label, run) {
      const start = now();
      try {
        return run();
      } finally {
        record(label, now() - start);
      }
    },

    tick() {
      const current = now();
      const windowStart = lastTick;
      lastTick = current;
      if (windowStart === null) return;
      const stalledMs = current - windowStart - TICK_MS;
      if (stalledMs < thresholdMs) return;

      const recent = breadcrumbs.filter((crumb) => crumb.at > windowStart).map(describe);
      const running = [...inFlight.values()]
        .map((entry) => `${entry.label} (${(current - entry.since).toFixed(0)}ms)`);
      log(`[perf] event-loop stall ${stalledMs.toFixed(0)}ms`
        + ` | in-flight: ${running.length ? running.join(', ') : 'none'}`
        + ` | recent: ${recent.length ? recent.join(', ') : 'none (timer or stream callback)'}`);
    },
  };
}

const NOOP: StallMonitor = {
  record() {},
  begin: () => () => {},
  sync: (_label, run) => run(),
  tick() {},
};

/** Process-wide monitor; the no-op unless diagnostics are enabled. */
export const stallMonitor: StallMonitor = isPerfDiagnosticsEnabled()
  ? createStallMonitor({ thresholdMs: readEnvInt('PERF_STALL_MS', DEFAULT_STALL_MS) })
  : NOOP;

/** Starts the interval when diagnostics are enabled; returns a stop function. */
export function startStallMonitor(): () => void {
  if (stallMonitor === NOOP) return () => {};
  console.log('[perf] event-loop stall monitor on');
  const timer = setInterval(() => stallMonitor.tick(), TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
