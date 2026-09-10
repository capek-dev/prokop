const listeners = new Set<() => void>();

/** Host event fanout. No model call, client polling, or persistent timer here. */
export function notifyLearningActivity(): void {
  for (const listener of listeners) {
    try { listener(); }
    catch (error: unknown) { console.error('[learning] Activity listener failed', error); }
  }
}

export function subscribeLearningActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
