import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PermissionMode } from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';

interface AutoApproveSelectorProps {
  sessionId: string;
  sdkClient: ProkopaiClient | null;
  disabled?: boolean;
}

interface ModeConfig {
  icon: typeof Shield;
  iconClass: string;
  tooltip: string;
  label: string;
  ariaLabel: string;
}

const MODE_CONFIGS: Record<PermissionMode, ModeConfig> = {
  standard: {
    icon: ShieldCheck,
    iconClass: 'text-success',
    tooltip: 'Permissions: Standard',
    label: 'Ordinary commands and workspace edits run automatically. Force/recursive deletes, secrets, and outside-workspace paths ask first.',
    ariaLabel: 'Permissions: standard',
  },
  extended: {
    icon: Shield,
    iconClass: 'text-success',
    tooltip: 'Permissions: Extended',
    label: 'Also reads and writes files anywhere on this machine. Secrets and destructive actions still ask.',
    ariaLabel: 'Permissions: extended',
  },
  full: {
    icon: ShieldAlert,
    iconClass: 'text-warning',
    tooltip: 'Permissions: Full access',
    label: 'Everything runs automatically except commands that can damage the system (rm -rf /, dd to a device, shutdown).',
    ariaLabel: 'Permissions: full access',
  },
};

const MODE_ORDER: PermissionMode[] = ['standard', 'extended', 'full'];

function getMenuItemIconClass(mode: PermissionMode): string {
  switch (mode) {
    case 'standard': return 'text-success';
    case 'extended': return 'text-success';
    case 'full': return 'text-warning';
  }
}

export function AutoApproveSelector({
  sessionId,
  sdkClient,
  disabled,
}: AutoApproveSelectorProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const updateSession = useSessionStore((s) => s.updateSession);

  const session = sessions.find((s) => s.id === sessionId);
  const currentMode: PermissionMode = session?.permissionMode ?? 'standard';
  const config = MODE_CONFIGS[currentMode];
  const Icon = config.icon;

  const handleModeChange = useCallback(async (mode: PermissionMode) => {
    if (!sdkClient) return;

    try {
      const result = await sdkClient.http.sessions.update(sessionId, {
        permissionMode: mode,
      });

      updateSession(result.session);
    } catch (err) {
      console.error('Failed to update permission mode:', err);
    }
  }, [sdkClient, sessionId, updateSession]);

  if (disabled) {
    return (
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-accent"
              disabled
              aria-label={config.ariaLabel}
            >
              <Icon className={`size-4 ${config.iconClass}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{config.tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 hover:bg-accent"
                aria-label={config.ariaLabel}
              >
                <Icon className={`size-4 ${config.iconClass}`} />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{config.tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" sideOffset={4} className="w-56">
        <DropdownMenuLabel>{config.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODE_ORDER.map((mode) => {
          const modeConfig = MODE_CONFIGS[mode];
          const ModeIcon = modeConfig.icon;
          const isActive = mode === currentMode;
          return (
            <DropdownMenuItem
              key={mode}
              onClick={() => handleModeChange(mode)}
              className={isActive ? 'bg-accent' : ''}
            >
              <ModeIcon className={`size-4 ${getMenuItemIconClass(mode)}`} />
              <span className="ml-2">{modeConfig.tooltip}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
