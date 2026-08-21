import { Shield, ShieldOff, ShieldAlert, ShieldCheck } from 'lucide-react';
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
import type { AutoApproveSeverity } from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useSessionStore } from '@/stores/sessionStore';

interface AutoApproveSelectorProps {
  sessionId: string;
  sdkClient: ProkopaiClient | null;
  disabled?: boolean;
}

type SeverityLevel = 'off' | 'none' | 'low' | 'medium' | 'high';

interface SeverityConfig {
  icon: typeof Shield;
  iconClass: string;
  tooltip: string;
  label: string;
  ariaLabel: string;
}

const SEVERITY_CONFIGS: Record<SeverityLevel, SeverityConfig> = {
  off: {
    icon: ShieldOff,
    iconClass: 'text-muted-foreground/60',
    tooltip: 'Auto-approve: Off',
    label: 'Always ask for approval.',
    ariaLabel: 'Auto-approve: off',
  },
  none: {
    icon: Shield,
    iconClass: 'text-muted-foreground',
    tooltip: 'Auto-approve: None',
    label: 'Auto-approve permissions with none risk.',
    ariaLabel: 'Auto-approve: none risk',
  },
  low: {
    icon: ShieldCheck,
    iconClass: 'text-success',
    tooltip: 'Auto-approve: Low',
    label: 'Auto-approve permissions with low risk and below.',
    ariaLabel: 'Auto-approve: low risk and below',
  },
  medium: {
    icon: ShieldCheck,
    iconClass: 'text-warning',
    tooltip: 'Auto-approve: Medium',
    label: 'Auto-approve permissions with medium risk and below.',
    ariaLabel: 'Auto-approve: medium risk and below',
  },
  high: {
    icon: ShieldAlert,
    iconClass: 'text-destructive',
    tooltip: 'Auto-approve: High',
    label: 'Auto-approve permissions with high risk and below.',
    ariaLabel: 'Auto-approve: high risk and below',
  },
};

const SEVERITY_ORDER: SeverityLevel[] = ['off', 'none', 'low', 'medium', 'high'];

function getMenuItemIconClass(level: SeverityLevel): string {
  switch (level) {
    case 'off': return '';
    case 'none': return 'text-muted-foreground';
    case 'low': return 'text-success';
    case 'medium': return 'text-warning';
    case 'high': return 'text-destructive';
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
  const currentLevel = (session?.autoApproveSeverity ?? 'low') as SeverityLevel;
  const config = SEVERITY_CONFIGS[currentLevel];
  const Icon = config.icon;

  const handleSeverityChange = useCallback(async (level: SeverityLevel) => {
    if (!sdkClient) return;

    try {
      const result = await sdkClient.http.sessions.update(sessionId, {
        autoApproveSeverity: level as AutoApproveSeverity,
      });

      updateSession(result.session);
    } catch (err) {
      console.error('Failed to update auto-approve setting:', err);
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
        {SEVERITY_ORDER.map((level) => {
          const levelConfig = SEVERITY_CONFIGS[level];
          const LevelIcon = levelConfig.icon;
          const isActive = level === currentLevel;
          return (
            <DropdownMenuItem
              key={level}
              onClick={() => handleSeverityChange(level)}
              className={isActive ? 'bg-accent' : ''}
            >
              <LevelIcon className={`size-4 ${getMenuItemIconClass(level)}`} />
              <span className="ml-2">{levelConfig.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
