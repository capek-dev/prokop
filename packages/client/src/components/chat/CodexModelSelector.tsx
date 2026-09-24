import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { CodexModelSelection, ProkopaiClient, Session } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  session: Session;
  client: ProkopaiClient | null;
  serverUrl: string | null;
  disabled: boolean;
}

export function CodexModelSelector({ session, client, serverUrl, disabled }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['codex-models', serverUrl, session.id];
  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: () => client!.http.sessions.codexModels(session.id),
    enabled: Boolean(client && serverUrl),
    staleTime: 60_000,
    retry: false,
  });
  const models = data?.models ?? [];
  const selectedModel = models.find(item => item.model === data?.selection?.model)
    ?? models.find(item => item.model === session.selectedModel)
    ?? models.find(item => item.isDefault);
  const effort = data?.selection && data.selection.model === selectedModel?.model
    ? data.selection.effort : selectedModel?.defaultEffort;
  const currentModelName = selectedModel?.name ?? data?.selection?.model ?? session.selectedModel;
  const rerouted = Boolean(data?.selection && session.selectedModel && session.selectedModel !== data.selection.model);

  const select = async (selection: CodexModelSelection) => {
    if (!client || disabled) return;
    try {
      const response = await client.http.sessions.setCodexModel(session.id, selection);
      queryClient.setQueryData(queryKey, (old: typeof data) => old && { ...old, selection: response.selection });
    } catch {
      toast.error('Could not change the Codex model or effort. Check the host and try again.');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled || !client} className="max-w-56" aria-label="Choose Codex model and effort">
          <span className="truncate" title={rerouted ? `Last reported by Codex: ${session.selectedModel}` : undefined}>
            {currentModelName ? `Codex · ${currentModelName}` : 'Codex · model unknown'}{effort ? ` (${effort})` : ''}
          </span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Codex models</DropdownMenuLabel>
          {rerouted && <DropdownMenuItem disabled>Last reported: {session.selectedModel}</DropdownMenuItem>}
          {!data?.selection && <DropdownMenuItem disabled>Using CLI defaults until selected</DropdownMenuItem>}
          {isPending && <DropdownMenuItem disabled>Loading models...</DropdownMenuItem>}
          {isError && <DropdownMenuItem disabled>Codex models unavailable</DropdownMenuItem>}
          {!isPending && !isError && models.length === 0 && <DropdownMenuItem disabled>No models available</DropdownMenuItem>}
          {models.map(model => (
            <DropdownMenuItem key={model.model} onSelect={() => void select({ model: model.model,
              effort: model.model === selectedModel?.model ? effort ?? model.defaultEffort : model.defaultEffort })}>
              <span className="min-w-0 flex-1 truncate" title={model.model}>{model.name}</span>
              {selectedModel?.model === model.model && <Check data-icon="inline-end" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {selectedModel && <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
            {selectedModel.supportedEfforts.map(option => (
              <DropdownMenuItem key={option} onSelect={() => void select({ model: selectedModel.model, effort: option })}>
                <span className="flex-1 capitalize">{option}</span>
                {effort === option && <Check data-icon="inline-end" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
