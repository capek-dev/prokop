import { useState } from 'react';
import { useRouter, useParams } from '@tanstack/react-router';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { useDemoteAgent } from '@/hooks/queries';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Bot, ChevronsUpDown, Check, Plus, MoreHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PromoteDialog } from '@/components/agent/PromoteDialog';
import type { Agent } from '@prokopai/sdk';

export function AgentSwitcher() {
  const router = useRouter();
  const params = useParams({ strict: false });
  const agents = useServerDataStore(s => s.agents);
  const sdkClient = useSdkClient();
  const [open, setOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [demoteAgent, setDemoteAgent] = useState<Agent | null>(null);

  const activeAgentId = params.agentId as string | undefined;
  const activeAgent = agents.find(a => a.id === activeAgentId);
  const serverId = params.serverId as string;

  const handleSelect = async (agentId: string) => {
    setOpen(false);

    const agentHomeId = `${agentId}-home`;

    try {
      const { workspace } = await sdkClient!.http.workspaces.get(agentHomeId);
      useServerDataStore.getState().setActiveWorkspace(workspace);
      localStorage.setItem('activeWorkspaceId', workspace.id);
    } catch (err) {
      console.error('[agent] Failed to load agent home workspace:', err);
    }

    router.navigate({
      to: `/server/$serverId/agent/$agentId` as never,
      params: { serverId, agentId } as never,
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select agent"
            className="w-full justify-between h-9"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Bot className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {activeAgent?.name || 'Select agent'}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0 max-h-[80vh]">
          <Command>
            <CommandInput placeholder="Search agents..." />
            <CommandList className="max-h-[50vh] overflow-y-auto">
              <CommandEmpty>No agents found.</CommandEmpty>
              <CommandGroup heading="Agents">
                {agents.map(agent => (
                  <CommandItem
                    key={agent.id}
                    showCheck={false}
                    onSelect={() => handleSelect(agent.id)}
                    value={`${agent.name} ${agent.id}`}
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <Bot className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{agent.name}</span>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <Check
                        className={cn(
                          'size-4',
                          activeAgentId === agent.id ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="p-1 rounded hover:bg-secondary transition-colors"
                            onClick={e => e.stopPropagation()}
                          >
                            <MoreHorizontal className="size-4" />
                            <span className="sr-only">Agent actions</span>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-48">
                          <DropdownMenuItem
                            onClick={e => {
                              e.stopPropagation();
                              setDemoteAgent(agent);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="size-4" />
                            Demote Agent
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setPromoteOpen(true);
                  }}
                >
                  <Plus className="size-4" data-icon="inline-start" />
                  Promote Preconfig
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <PromoteDialog open={promoteOpen} onOpenChange={setPromoteOpen} />

      {demoteAgent && (
        <DemoteAgentDialog agent={demoteAgent} onClose={() => setDemoteAgent(null)} />
      )}
    </>
  );
}

function DemoteAgentDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const sdkClient = useSdkClient();
  const demoteMutation = useDemoteAgent(sdkClient);

  const handleDemote = () => {
    demoteMutation.mutate(agent.id, { onSuccess: onClose });
  };

  return (
    <ConfirmationDialog
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={`Demote ${agent.name}?`}
      description="This will remove the agent directory and its home workspace. Sessions created in the home workspace will be deleted. The original preconfig is preserved."
      confirmLabel="Demote"
      variant="destructive"
      onConfirm={handleDemote}
    />
  );
}
