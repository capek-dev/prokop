import { Shield, Eye } from 'lucide-react';
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
  TooltipTrigger,
} from '@/components/ui/tooltip';

type ControlUiState = 'uncontrolled' | 'controller' | 'observer';

interface SessionControlButtonProps {
  uiState: ControlUiState;
  sessionId: string;
  onClaimControl?: (sessionId: string) => void;
}

function getConfig(state: ControlUiState) {
  switch (state) {
    case 'uncontrolled':
      return {
        icon: Shield,
        tooltip: 'No active controller',
        label: 'No client currently controls this session.',
        ariaLabel: 'Session control: no active controller',
        iconClass: 'text-muted-foreground/60',
      };
    case 'controller':
      return {
        icon: Shield,
        tooltip: 'You control this session',
        label: 'You are controlling this session.',
        ariaLabel: 'Session control: you control this session',
        iconClass: 'text-muted-foreground',
      };
    case 'observer':
      return {
        icon: Eye,
        tooltip: 'Controlled on another device',
        label: 'Another client is controlling this session.',
        ariaLabel: 'Session control: controlled on another device',
        iconClass: 'text-muted-foreground',
      };
  }
}

export function SessionControlButton({
  uiState,
  sessionId,
  onClaimControl,
}: SessionControlButtonProps) {
  const config = getConfig(uiState);
  const Icon = config.icon;

  const canClaim = (uiState === 'uncontrolled' || uiState === 'observer') && !!onClaimControl;

  if (!canClaim) {
    return null;
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={config.ariaLabel}
            >
              <Icon className={`size-4 ${config.iconClass}`} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{config.tooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={4} className="w-56">
        <DropdownMenuLabel>{config.label}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => onClaimControl(sessionId)}>
          <Shield className="size-4" />
          Take control
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
