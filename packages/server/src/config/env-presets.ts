export interface EnvPreset {
  key: string;
  /** Legacy pre-rename key, still readable for compatibility. */
  legacyKey?: string;
  description: string;
  category: string;
  sensitive: boolean;
  example?: string;
  defaultValue?: string;
  link?: {
    label: string;
    url: string;
  };
}

export const ENV_PRESETS: EnvPreset[] = [
  // --- Gmail OAuth ---
  {
    key: 'PROKOPAI_GMAIL_CLIENT_ID',
    legacyKey: 'JEAN2_GMAIL_CLIENT_ID',
    description: 'Google OAuth Client ID for Gmail integration',
    category: 'Gmail OAuth',
    sensitive: false,
    example: '123456789-abc...apps.googleusercontent.com',
    link: {
      label: 'Google Cloud Console',
      url: 'https://console.cloud.google.com/apis/credentials',
    },
  },
  {
    key: 'PROKOPAI_GMAIL_CLIENT_SECRET',
    legacyKey: 'JEAN2_GMAIL_CLIENT_SECRET',
    description: 'Google OAuth Client Secret for Gmail integration',
    category: 'Gmail OAuth',
    sensitive: true,
    example: 'GOCSPX-...',
    link: {
      label: 'Google Cloud Console',
      url: 'https://console.cloud.google.com/apis/credentials',
    },
  },
];

const presetKeySet = new Set(
  ENV_PRESETS.flatMap((p) => [p.key, ...(p.legacyKey ? [p.legacyKey] : [])]),
);

export function getPreset(key: string): EnvPreset | undefined {
  return ENV_PRESETS.find((p) => p.key === key || p.legacyKey === key);
}

export function isPresetKey(key: string): boolean {
  return presetKeySet.has(key);
}
