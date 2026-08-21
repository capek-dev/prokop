import { Suspense, lazy } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { Key, Boxes, FileText, Layers, Link2, Braces, Terminal, User, Palette, Keyboard, Wrench, FolderOpen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUIStore } from '@/stores/uiStore';
import type { ConfigurationSection } from '@/stores/uiStore';

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

function PanelLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-32 text-muted-foreground">
      <div className="h-5 w-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
    </div>
  );
}

interface ConfigurationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sdkClient: ProkopaiClient | null;
  apiToken: string | null;
  isConnected: boolean;
  onLogout: () => void;
}

type SectionGroup = 'preferences' | 'server';
type IconType = typeof Key;

interface SectionDef {
  value: ConfigurationSection;
  label: string;
  icon: IconType;
  group: SectionGroup;
}

const SECTIONS: SectionDef[] = [
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

function renderPanel(value: ConfigurationSection, sdkClient: ProkopaiClient | null, extra: { apiToken: string | null; isConnected: boolean; onLogout: () => void; open: boolean }) {
  return (
    <Suspense fallback={<PanelLoadingFallback />}>
      {(() => {
        switch (value) {
          case 'account':
            return <AccountPanel apiToken={extra.apiToken} isConnected={extra.isConnected} onLogout={extra.onLogout} sdkClient={sdkClient} open={extra.open} />;
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
}

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

  const prefSections = SECTIONS.filter((s) => s.group === 'preferences');
  const serverSections = SECTIONS.filter((s) => s.group === 'server');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden p-3 sm:p-4 gap-3 sm:gap-4 max-w-[calc(100vw-0.5rem)] sm:max-w-[860px] h-[85dvh] sm:h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage preferences, credentials, models, agents, and environment
          </DialogDescription>
        </DialogHeader>

        {/* Mobile: Select dropdown */}
        <Select
          value={section}
          onValueChange={(v) => setSection(v as ConfigurationSection)}
        >
          <SelectTrigger className="sm:hidden w-full shrink-0" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_pref_group" disabled className="text-xs font-semibold text-muted-foreground">Preferences</SelectItem>
            {prefSections.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <s.icon className="size-4" />
                {s.label}
              </SelectItem>
            ))}
            <SelectItem value="_server_group" disabled className="text-xs font-semibold text-muted-foreground">Server</SelectItem>
            {serverSections.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                <s.icon className="size-4" />
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs
          value={section}
          onValueChange={(v) => setSection(v as ConfigurationSection)}
          orientation="vertical"
          className="mt-2 flex-1 min-h-0"
        >
          {/* Desktop sidebar */}
          <TabsList className="hidden sm:flex flex-col h-fit w-44 lg:w-48 shrink-0 items-stretch gap-0.5 bg-transparent p-1 rounded-lg">
            <span className="px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preferences</span>
            {prefSections.map((s) => (
              <TabsTrigger
                key={s.value}
                value={s.value}
                className="justify-start px-3 py-1.5 text-sm"
              >
                <s.icon className="size-4" data-icon="inline-start" />
                <span>{s.label}</span>
              </TabsTrigger>
            ))}
            <span className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Server</span>
            {serverSections.map((s) => (
              <TabsTrigger
                key={s.value}
                value={s.value}
                className="justify-start px-3 py-1.5 text-sm"
              >
                <s.icon className="size-4" data-icon="inline-start" />
                <span>{s.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Shared content area - only mount the selected panel */}
          <div className="dialog-scrollbar flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain rounded-lg border">
            <TabsContent key={section} value={section} className="mt-0">
              {renderPanel(section, sdkClient, { apiToken, isConnected, onLogout, open })}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
