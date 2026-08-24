import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeScheme = 'neutral' | 'ocean' | 'forest' | 'sunset' | 'amethyst';

interface ThemeSettings {
  mode: ThemeMode;
  scheme: ThemeScheme;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultMode?: ThemeMode;
  defaultScheme?: ThemeScheme;
  storageKey?: string;
}

interface ThemeProviderState {
  mode: ThemeMode;
  scheme: ThemeScheme;
  setMode: (mode: ThemeMode) => void;
  setScheme: (scheme: ThemeScheme) => void;
  resolvedMode: 'dark' | 'light';
}

const LEGACY_STORAGE_KEY = 'jean2-theme';
const DEFAULT_SCHEME: ThemeScheme = 'neutral';
const DEFAULT_MODE: ThemeMode = 'system';

const initialState: ThemeProviderState = {
  mode: DEFAULT_MODE,
  scheme: DEFAULT_SCHEME,
  setMode: () => null,
  setScheme: () => null,
  resolvedMode: 'dark',
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

function getSystemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getResolvedMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return getSystemTheme();
  }
  return mode;
}

function migrateLegacyTheme(storageKey: string): ThemeSettings | null {
  const legacyValue = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!legacyValue) return null;

  const validModes: ThemeMode[] = ['light', 'dark', 'system'];
  if (!validModes.includes(legacyValue as ThemeMode)) return null;

  const settings: ThemeSettings = {
    mode: legacyValue as ThemeMode,
    scheme: DEFAULT_SCHEME,
  };

  localStorage.setItem(storageKey, JSON.stringify(settings));
  localStorage.removeItem(LEGACY_STORAGE_KEY);

  return settings;
}

export function ThemeProvider({
  children,
  defaultMode = DEFAULT_MODE,
  defaultScheme = DEFAULT_SCHEME,
  storageKey = 'prokopai-theme-settings',
  ...props
}: ThemeProviderProps) {
  const [settings, setSettings] = useState<ThemeSettings>(() => {
    const migrated = migrateLegacyTheme(storageKey);
    if (migrated) return migrated;

    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as ThemeSettings;
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          'mode' in parsed &&
          'scheme' in parsed
        ) {
          return parsed;
        }
      } catch {
        // Invalid JSON, use defaults
      }
    }

    return { mode: defaultMode, scheme: defaultScheme };
  });

  const [resolvedMode, setResolvedMode] = useState<'dark' | 'light'>(() =>
    getResolvedMode(settings.mode)
  );

  const applyThemeClasses = useCallback((mode: ThemeMode, scheme: ThemeScheme) => {
    const root = window.document.documentElement;
    const resolved = getResolvedMode(mode);

    root.classList.remove('light', 'dark');
    root.classList.remove('neutral', 'ocean', 'forest', 'sunset', 'amethyst');

    root.classList.add(resolved);
    root.classList.add(scheme);

    setResolvedMode(resolved);
  }, []);

  useEffect(() => {
    applyThemeClasses(settings.mode, settings.scheme);
  }, [settings, applyThemeClasses]);

  useEffect(() => {
    if (settings.mode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      applyThemeClasses(settings.mode, settings.scheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [settings.mode, settings.scheme, applyThemeClasses]);

  const setMode = useCallback(
    (mode: ThemeMode) => {
      const newSettings = { ...settings, mode };
      setSettings(newSettings);
      localStorage.setItem(storageKey, JSON.stringify(newSettings));
    },
    [settings, storageKey]
  );

  const setScheme = useCallback(
    (scheme: ThemeScheme) => {
      const newSettings = { ...settings, scheme };
      setSettings(newSettings);
      localStorage.setItem(storageKey, JSON.stringify(newSettings));
    },
    [settings, storageKey]
  );

  const value: ThemeProviderState = {
    mode: settings.mode,
    scheme: settings.scheme,
    setMode,
    setScheme,
    resolvedMode,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
