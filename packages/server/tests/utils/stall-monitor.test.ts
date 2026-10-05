import { expect, test } from 'bun:test';
import { activityLabel, createStallMonitor } from '@/utils/stall-monitor';

function harness() {
  let time = 0;
  const lines: string[] = [];
  const monitor = createStallMonitor({ thresholdMs: 50, now: () => time, log: (line) => lines.push(line) });
  return { monitor, lines, advance: (ms: number) => { time += ms; } };
}

test('on-time ticks and the first tick report nothing', () => {
  const h = harness();
  h.advance(5_000);
  h.monitor.tick();
  for (let i = 0; i < 5; i++) {
    h.advance(120);
    h.monitor.tick();
  }
  expect(h.lines).toEqual([]);
});

test('a late tick reports the stall with what ran during it', () => {
  const h = harness();
  h.monitor.tick();
  h.monitor.record('out part.append');
  h.advance(10);
  const done = h.monitor.begin('GET /api/workspaces/:id/git/status');
  h.monitor.sync('ws chat.message', () => h.advance(300));
  h.monitor.record('out part.append');
  h.monitor.record('out part.append');
  h.monitor.tick();

  expect(h.lines).toHaveLength(1);
  expect(h.lines[0]).toContain('event-loop stall 210ms');
  expect(h.lines[0]).toContain('in-flight: GET /api/workspaces/:id/git/status (300ms)');
  expect(h.lines[0]).toContain('ws chat.message (sync 300ms)');
  expect(h.lines[0]).toContain('out part.append x2');

  done();
  h.advance(400);
  h.monitor.tick();
  expect(h.lines[1]).toContain('in-flight: none');
  expect(h.lines[1]).toContain('recent: none (timer or stream callback)');
});

test('breadcrumbs from before the stall window are left out', () => {
  const h = harness();
  h.monitor.tick();
  h.monitor.record('GET /api/models');
  h.advance(100);
  h.monitor.tick();
  h.advance(400);
  h.monitor.tick();
  expect(h.lines[0]).not.toContain('/api/models');
});

test('the synchronous part of an async handler is measured', async () => {
  const h = harness();
  h.monitor.tick();
  await h.monitor.sync('GET /api/slow', async () => {
    h.advance(80);
    await Promise.resolve();
    h.advance(1_000);
  });
  h.monitor.tick();
  expect(h.lines[0]).toContain('GET /api/slow (sync 80ms)');
});

test('activity labels collapse ids', () => {
  expect(activityLabel('GET', '/api/workspaces/0f8fad5b-d9cb-469f-a165-70867728950e/git/status'))
    .toBe('GET /api/workspaces/:id/git/status');
});
