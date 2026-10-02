import { Suspense, lazy } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { Boxes, FileText, Layers, Braces, MonitorCog, Palette, Keyboard, Wrench, CircuitBoard } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import type { ConfigurationSection } from '@/stores/uiStore';
import { SettingsDialogShell, PanelLoadingFallback, type SettingsSection } from './SettingsDialogShell';

const HarnessesPanel = lazy(() => import('./configuration/HarnessesPanel').then((m) => ({ default: m.HarnessesPanel })));
const ProvidersModelsPanel = lazy(() => import('./configuration/ProvidersModelsPanel').then((m) => ({ default: m.ProvidersModelsPanel })));
const PromptsPanel = lazy(() => import('./configuration/PromptsPanel').then((m) => ({ default: m.PromptsPanel })));
const PreconfigsPanel = lazy(() => import('./configuration/PreconfigsPanel').then((m) => ({ default: m.PreconfigsPanel })));
const ResponseFormatsPanel = lazy(() => import('./configuration/ResponseFormatsPanel').then((m) => ({ default: m.ResponseFormatsPanel })));
const ToolsEnvironmentPanel = lazy(() => import('./configuration/ToolsEnvironmentPanel').then((m) => ({ default: m.ToolsEnvironmentPanel })));
const SystemPanel = lazy(() => import('./configuration/SystemPanel').then((m) => ({ default: m.SystemPanel })));
const AppearancePanel = lazy(() => import('./configuration/AppearancePanel').then((m) => ({ default: m.AppearancePanel })));
const KeybindsPanel = lazy(() => import('./configuration/KeybindsPanel').then((m) => ({ default: m.KeybindsPanel })));

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
  { value: 'appearance', label: 'Appearance', icon: Palette, group: 'preferences' },
  { value: 'keybinds', label: 'Keybinds', icon: Keyboard, group: 'preferences' },
  // Server: shared across harnesses (prompts are client-level text shortcuts, harness-agnostic)
  { value: 'harnesses', label: 'Harnesses', icon: CircuitBoard, group: 'server' },
  { value: 'preconfigs', label: 'Agents', icon: Layers, group: 'server' },
  { value: 'prompts', label: 'Prompts', icon: FileText, group: 'server' },
  // Prokop runtime
  { value: 'providers-models', label: 'Providers & Models', icon: Boxes, group: 'prokop' },
  { value: 'response-formats', label: 'Formats', icon: Braces, group: 'prokop' },
  { value: 'tools-env', label: 'Tools & Environment', icon: Wrench, group: 'prokop' },
  // System: connection/version, pinned to the bottom
  { value: 'system', label: 'System', icon: MonitorCog, group: 'system' },
];

const GROUPS = [
  { key: 'preferences', label: 'Preferences' },
  { key: 'server', label: 'Server' },
  { key: 'prokop', label: 'Prokop' },
  { key: 'system' },
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
          case 'system':
            return <SystemPanel apiToken={apiToken} isConnected={isConnected} onLogout={onLogout} sdkClient={sdkClient} open={open} />;
          case 'appearance':
            return <AppearancePanel />;
          case 'keybinds':
            return <KeybindsPanel />;
          case 'harnesses':
            return <HarnessesPanel sdkClient={sdkClient} />;
          case 'preconfigs':
            return <PreconfigsPanel sdkClient={sdkClient} />;
          case 'providers-models':
            return <ProvidersModelsPanel sdkClient={sdkClient} />;
          case 'prompts':
            return <PromptsPanel sdkClient={sdkClient} />;
          case 'response-formats':
            return <ResponseFormatsPanel sdkClient={sdkClient} />;
          case 'tools-env':
            return <ToolsEnvironmentPanel sdkClient={sdkClient} />;
        }
      })()}
    </Suspense>
  );

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Manage preferences, harnesses, agents, and the Prokop runtime"
      sections={SECTIONS}
      groups={GROUPS}
      value={section}
      onValueChange={(v) => setSection(v as ConfigurationSection)}
      renderPanel={renderPanel}
    />
  );
}
