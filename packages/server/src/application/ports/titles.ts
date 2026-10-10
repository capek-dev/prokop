import type { MessageWithParts } from '@prokopai/sdk';

/**
 * Title policy and generation port for the universal server-side title
 * service. The infrastructure implementation (infrastructure/session-title)
 * fulfills it; the planned title-model picker lands behind this port so every
 * harness shares one generation surface.
 */
export interface TitleGenerationPort {
  isDefaultSessionTitle(title: string | null | undefined): boolean;
  hasManualSessionTitle(metadata: Record<string, unknown> | null | undefined): boolean;
  generateSessionTitle(messages: MessageWithParts[]): Promise<string | null>;
  /** A title from the first prompt's words; needs no model. */
  fallbackSessionTitle(messages: MessageWithParts[]): string | null;
}
