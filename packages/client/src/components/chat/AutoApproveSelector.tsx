import { ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useSessionById } from '@/contexts/HostScopeContext';

interface AutoApproveSelectorProps {
  sessionId: string;
  sdkClient: ProkopaiClient | null;
  disabled?: boolean;
}

interface ModeConfig {
  icon: typeof ShieldCheck;
  iconClass: string;
  label: string;
  ariaLabel: string;
}

const MODE_CONFIGS: Record<PermissionMode, ModeConfig> = {
  standard: {
    icon: ShieldCheck,
    iconClass: 'text-success',
    label: 'Standard',
    ariaLabel: 'Standard permissions',
  },
  extended: {
    icon: ShieldHalf,
    iconClass: 'text-warning',
    label: 'Extended',
    ariaLabel: 'Extended permissions',
  },
  full: {
    icon: ShieldAlert,
    iconClass: 'text-destructive',
    label: 'Full access',
    ariaLabel: 'Full access permissions',
  },
};

const MODE_ORDER: PermissionMode[] = ['standard', 'extended', 'full'];

function getMenuItemIconClass(mode: PermissionMode): string {
  switch (mode) {
    case 'standard': return 'text-success';
    case 'extended': return 'text-warning';
    case 'full': return 'text-destructive';
  }
}

export function AutoApproveSelector({
  sessionId,
  sdkClient,
  disabled,
}: AutoApproveSelectorProps) {
  const updateSession = useSessionStore((s) => s.updateSession);
  const session = useSessionById(sessionId);
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
          <TooltipContent>{config.label}</TooltipContent>
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
          <TooltipContent>{config.label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" sideOffset={4}>
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
              <span>{modeConfig.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
