import { Suspense, lazy } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { Key, Boxes, FileText, Layers, Link2, Braces, Terminal, User, Palette, Keyboard, Wrench, FolderOpen } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import type { ConfigurationSection } from '@/stores/uiStore';
import { SettingsDialogShell, PanelLoadingFallback, type SettingsSection } from './SettingsDialogShell';

const ProviderCredentialsPanel = lazy(() => import('./configuration/ProviderCredentialsPanel').then((m) => ({ default: m.ProviderCredentialsPanel })));
const OAuthProvidersPanel = lazy(() => import('./configuration/OAuthProvidersPanel').then((m) => ({ default: m.OAuthProvidersPanel })));
const ModelsPanel = lazy(() => import('./configuration/ModelsPanel').then((m) => ({ default: m.ModelsPanel })));
const PromptsPanel = lazy(() => import('./configuration/PromptsPanel').then((m) => ({ default: m.PromptsPanel })));
const PreconfigsPanel = lazy(() => import('./configuration/PreconfigsPanel').then((m) => ({ default: m.PreconfigsPanel })));
const ResponseFormatsPanel = lazy(() => import('./configuration/ResponseFormatsPanel').then((m) => ({ default: m.ResponseFormatsPanel })));
const EnvPanel = lazy(() => import('./configuration/EnvPanel').then((m) => ({ default: m.EnvPanel })));
const ToolsPanel = lazy(() => import('./tools/ToolsPanel').then((m) => ({ default: m.ToolsPanel })));
const AccountPanel = lazy(() => import('./configuration/AccountPanel').then((m) => ({ default: m.AccountPanel })));
const AppearancePanel = lazy(() => import('./configuration/AppearancePanel').then((m) => ({ default: m.AppearancePanel })));
const KeybindsPanel = lazy(() => import('./configuration/KeybindsPanel').then((m) => ({ default: m.KeybindsPanel })));
const FilesPanelPreferences = lazy(() => import('./configuration/FilesPanelPreferences').then((m) => ({ default: m.FilesPanelPreferences })));

interface ConfigurationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sdkClient: ProkopaiClient | null;
  apiToken: string | null;
  isConnected: boolean;
  onLogout: () => void;
}

const SECTIONS: SettingsSection[] = [
  // Preferences
  { value: 'account', label: 'Account', icon: User, group: 'preferences' },
  { value: 'appearance', label: 'Appearance', icon: Palette, group: 'preferences' },
  { value: 'keybinds', label: 'Keybinds', icon: Keyboard, group: 'preferences' },
  { value: 'files', label: 'Files', icon: FolderOpen, group: 'preferences' },
  // Server
  { value: 'providers', label: 'Credentials', icon: Key, group: 'server' },
  { value: 'oauth', label: 'OAuth', icon: Link2, group: 'server' },
  { value: 'models', label: 'Models', icon: Boxes, group: 'server' },
  { value: 'prompts', label: 'Prompts', icon: FileText, group: 'server' },
  { value: 'preconfigs', label: 'Preconfigs', icon: Layers, group: 'server' },
  { value: 'response-formats', label: 'Formats', icon: Braces, group: 'server' },
  { value: 'env', label: 'Environment', icon: Terminal, group: 'server' },
  { value: 'tools', label: 'Tools', icon: Wrench, group: 'server' },
];

const GROUPS = [
  { key: 'preferences', label: 'Preferences' },
  { key: 'server', label: 'Server' },
];

export function ConfigurationDialog({
  open,
  onOpenChange,
  sdkClient,
  apiToken,
  isConnected,
  onLogout,
}: ConfigurationDialogProps) {
  const section = useUIStore((s) => s.configurationSection);
  const setSection = useUIStore((s) => s.setConfigurationSection);

  const renderPanel = (value: string) => (
    <Suspense fallback={<PanelLoadingFallback />}>
      {(() => {
        switch (value) {
          case 'account':
            return <AccountPanel apiToken={apiToken} isConnected={isConnected} onLogout={onLogout} sdkClient={sdkClient} open={open} />;
          case 'appearance':
            return <AppearancePanel />;
          case 'keybinds':
            return <KeybindsPanel />;
          case 'files':
            return <FilesPanelPreferences />;
          case 'providers':
            return <ProviderCredentialsPanel sdkClient={sdkClient} />;
          case 'oauth':
            return <OAuthProvidersPanel sdkClient={sdkClient} />;
          case 'models':
            return <ModelsPanel sdkClient={sdkClient} />;
          case 'prompts':
            return <PromptsPanel sdkClient={sdkClient} />;
          case 'preconfigs':
            return <PreconfigsPanel sdkClient={sdkClient} />;
          case 'response-formats':
            return <ResponseFormatsPanel sdkClient={sdkClient} />;
          case 'env':
            return <EnvPanel sdkClient={sdkClient} />;
          case 'tools':
            return <ToolsPanel sdkClient={sdkClient} />;
        }
      })()}
    </Suspense>
  );

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Manage preferences, credentials, models, and environment"
      sections={SECTIONS}
      groups={GROUPS}
      value={section}
      onValueChange={(v) => setSection(v as ConfigurationSection)}
      renderPanel={renderPanel}
    />
  );
}
