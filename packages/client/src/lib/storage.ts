export interface StorageEntry<T> {
  exists: boolean;
  value: T | null;
}

function localStorageGetEntry<T>(key: string): StorageEntry<T> {
  const item = localStorage.getItem(key);
  if (item === null) return { exists: false, value: null };

  try {
    return { exists: true, value: JSON.parse(item) as T };
  } catch {
    return { exists: true, value: null };
  }
}

function localStorageGet<T>(key: string): T | null {
  return localStorageGetEntry<T>(key).value;
}

export const storage = {
  async get<T>(key: string): Promise<T | null> {
    return localStorageGet<T>(key);
  },

  async getEntry<T>(key: string): Promise<StorageEntry<T>> {
    return localStorageGetEntry<T>(key);
  },

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  },

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  },

  async clear(): Promise<void> {
    localStorage.clear();
  },

};

export const STORAGE_KEYS = {
  API_TOKEN: 'prokopai_api_token',
  TOKEN_EXPIRY: 'prokopai_token_expiry',
  SERVER_URL: 'prokopai_server_url',
  THEME: 'prokopai-theme',
  ACTIVE_WORKSPACE_ID: 'activeWorkspaceId',
  CLIENT_ID: 'prokopai_client_id',
  OVERVIEW_GROUPS: 'prokopai_overview_groups',
} as const;

/**
 * Pre-rename localStorage keys. Copied to their canonical names once at
 * startup when the canonical key is absent, then removed. Web origin storage
 * survives the jean2 → prokopai rename; this preserves user settings, tokens,
 * and server URLs across it.
 */
const LEGACY_STORAGE_KEYS: Record<string, string> = {
  jean2_api_token: STORAGE_KEYS.API_TOKEN,
  jean2_token_expiry: STORAGE_KEYS.TOKEN_EXPIRY,
  jean2_server_url: STORAGE_KEYS.SERVER_URL,
  'jean2-theme': STORAGE_KEYS.THEME,
  jean2_client_id: STORAGE_KEYS.CLIENT_ID,
  jean2_servers: 'prokopai_servers',
  jean2_quick_connections: 'prokopai_quick_connections',
  jean2_sessions_panel_width: 'prokopai_sessions_panel_width',
  jean2_files_panel_width: 'prokopai_files_panel_width',
  jean2_overview_groups: STORAGE_KEYS.OVERVIEW_GROUPS,
  jean2_editor_width_pct: 'prokopai_editor_width_pct',
  jean2_collapsed_tags: 'prokopai_collapsed_tags',
  jean2_collapsed_workspaces: 'prokopai_collapsed_workspaces',
  jean2_notify_completion: 'prokopai_notify_completion',
  jean2_notify_permission: 'prokopai_notify_permission',
  jean2_sound_chat_finish_enabled: 'prokopai_sound_chat_finish_enabled',
  jean2_sound_permission_enabled: 'prokopai_sound_permission_enabled',
  jean2_default_file_open_mode: 'prokopai_default_file_open_mode',
  jean2_auto_approve_severity: 'prokopai_auto_approve_severity',
  jean2_notification_registration: 'prokopai_notification_registration',
  'jean2-theme-settings': 'prokopai-theme-settings',
};

function migrateLegacyStorageKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    for (const [legacyKey, canonicalKey] of Object.entries(LEGACY_STORAGE_KEYS)) {
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue === null) continue;
      if (localStorage.getItem(canonicalKey) === null) {
        localStorage.setItem(canonicalKey, legacyValue);
      }
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // Storage unavailable (private mode etc.) - start fresh
  }
}

migrateLegacyStorageKeys();
