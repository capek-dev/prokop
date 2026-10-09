// Fired after writes that change what needs the user's attention: pending asks
// (approvals, questions) and session running state. Listeners recompute from
// the database, so the signal carries no data and may fire more than needed.

type AttentionListener = () => void;

const listeners = new Set<AttentionListener>();

export function onAttentionChanged(listener: AttentionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyAttentionChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error: unknown) {
      console.error('[attention] listener failed:', error);
    }
  }
}
