export type SessionControlStatus =
  | 'uncontrolled'
  | 'controlled'
  | 'takeover_requested'
  | 'grace';

export interface SessionControlState {
  sessionId: string;
  controllerClientId: string | null;
  controllerConnectionId?: string | null;
  acquiredAt?: number | null;
  leaseExpiresAt?: number | null;
  lastHeartbeatAt?: number | null;
  status: SessionControlStatus;
  pendingTakeover?: {
    requestedByClientId: string;
    requestedAt: number;
  } | null;
}

export interface SessionParticipantInfo {
  clientId: string;
  connectionIds: Set<string>;
}

// =============================================================================
// Client Capabilities
//
// Declared by clients during registration. Used by the server for
// capability-aware ask routing.
// =============================================================================

export type ClientCapability = string;
// `ClientCapability` is intentionally open-ended so new client-integrated
// features do not require SDK core type changes.
//
// `WELL_KNOWN_CLIENT_CAPABILITIES` is only a conventional list of common
// built-in capability names, not the exhaustive set of valid capabilities.
export const WELL_KNOWN_CLIENT_CAPABILITIES = [
  'chat_ui',
  'ask_ui',
  'browser_automation',
  'active_tab_read',
  'browser_dom_action',
  'browser_navigate',
  'browser_screenshot',
  'browser_discover_elements',
  'browser_tab_manage',
  'tab_context',
  'notifications',
  'terminal_ui',
  'file_picker',
] as const;

// =============================================================================
// Ask Authority
//
// Governs who can see an ask and who can respond to it.
// =============================================================================

export interface AskAuthority {
  visibilityScope: 'controller_only' | 'session_participants' | 'global';
  resolutionMode: 'controller_only' | 'designated_clients' | 'first_eligible';
  allowedResponderClientIds?: string[];
  requiredCapabilities?: ClientCapability[];
}
