import { DRAFT_KEY_PREFIX, DRAFT_TTL_MS, cleanupExpiredDrafts as cleanupExpiredDraftsShared } from '@prokopai/sdk';
import type { SavedDraft } from '@prokopai/sdk';

export function getDraftKey(sessionId: string): string {
  return `${DRAFT_KEY_PREFIX}${sessionId}`;
}

export function saveDraft(sessionId: string, text: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      getDraftKey(sessionId),
      JSON.stringify({
        text,
        updatedAt: Date.now(),
      } satisfies SavedDraft),
    );
  } catch (error) {
    console.warn('Error saving draft:', error);
  }
}

export function loadDraft(sessionId: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const stored = localStorage.getItem(getDraftKey(sessionId));
    if (stored === null) return '';
    const parsed = JSON.parse(stored) as SavedDraft;
    if (typeof parsed.text !== 'string' || typeof parsed.updatedAt !== 'number') {
      localStorage.removeItem(getDraftKey(sessionId));
      return '';
    }
    if (Date.now() - parsed.updatedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(getDraftKey(sessionId));
      return '';
    }
    return parsed.text;
  } catch {
    return '';
  }
}

export function clearDraft(sessionId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getDraftKey(sessionId));
  } catch (error) {
    console.warn('Error clearing draft:', error);
  }
}

export function cleanupExpiredDrafts(): void {
  cleanupExpiredDraftsShared();
}
