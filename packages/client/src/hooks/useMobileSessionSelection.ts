import { useCallback } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import type { ResumeSessionOptions } from '@/stores/sessionStore';

export type ResumeSession = (
  sessionId: string,
  options?: ResumeSessionOptions,
) => void;

export function useMobileSessionSelection(
  resumeSession: ResumeSession,
): ResumeSession {
  const isMobile = useIsMobile();

  return useCallback((sessionId, options) => {
    resumeSession(
      sessionId,
      isMobile ? { ...options, skipNavigation: true } : options,
    );
    if (isMobile) {
      useChatLayoutStore.getState().setMobileSurface('chat');
    }
  }, [isMobile, resumeSession]);
}
