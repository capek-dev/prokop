import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { claudeTranscriptPath } from './transcript';

interface GoalRecord {
  type?: unknown;
  sessionId?: unknown;
  timestamp?: unknown;
  isSidechain?: unknown;
  attachment?: { type?: unknown; condition?: unknown; sentinel?: unknown; met?: unknown; iterations?: unknown };
}

/** Only a new, same-session native evaluator verdict can complete this Goal. */
export async function readClaudeGoalVerdict(input: {
  root: string; nativeId: string; condition: string; startedAt: number;
}): Promise<number | null> {
  const path = claudeTranscriptPath(input.root, input.nativeId);
  if (!path) return null;

  let bytes = 0;
  let marker = false;
  let verdict: number | null = null;
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      bytes += Buffer.byteLength(line, 'utf8') + 1;
      if (bytes > 64 * 1024 * 1024 || line.length > 2 * 1024 * 1024) return null;
      if (!line.includes('"goal_status"')) continue;
      let entry: GoalRecord;
      try { entry = JSON.parse(line) as GoalRecord; } catch { return null; }
      if (entry.type !== 'attachment' || entry.sessionId !== input.nativeId || entry.isSidechain !== false) return null;
      const goal = entry.attachment;
      if (goal?.type !== 'goal_status') continue;
      const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
      if (!Number.isFinite(timestamp)) return null;
      if (timestamp < input.startedAt) continue;
      // A different goal or a second set/clear after this one invalidates the verdict.
      if (goal.condition !== input.condition) { marker = false; verdict = null; continue; }
      if (goal.sentinel === true && goal.met === false) { marker = true; verdict = null; continue; }
      if (!marker) return null;
      if (goal.sentinel !== true && goal.met === true && Number.isSafeInteger(goal.iterations)
        && (goal.iterations as number) > 0) verdict = goal.iterations as number;
      else verdict = null;
    }
  } catch { return null; }
  finally { lines.close(); stream.destroy(); }
  return marker ? verdict : null;
}
