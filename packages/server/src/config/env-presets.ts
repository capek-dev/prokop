export interface EnvPreset {
  key: string;
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
    key: 'JEAN2_GMAIL_CLIENT_ID',
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
    key: 'JEAN2_GMAIL_CLIENT_SECRET',
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

const presetKeySet = new Set(ENV_PRESETS.map(p => p.key));

export function getPreset(key: string): EnvPreset | undefined {
  return ENV_PRESETS.find(p => p.key === key);
}

export function isPresetKey(key: string): boolean {
  return presetKeySet.has(key);
}
