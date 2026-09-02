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

export const ENV_PRESETS: EnvPreset[] = [];

const presetKeySet = new Set(
  ENV_PRESETS.flatMap((p) => [p.key, ...(p.legacyKey ? [p.legacyKey] : [])]),
);

export function getPreset(key: string): EnvPreset | undefined {
  return ENV_PRESETS.find((p) => p.key === key || p.legacyKey === key);
}

export function isPresetKey(key: string): boolean {
  return presetKeySet.has(key);
}
