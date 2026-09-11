import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { useSessionStore } from '@/stores/sessionStore';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';

export function SessionLearningMenu({ sessionId }: { sessionId: string }) {
  const client = useSdkClient();
  const session = useSessionStore(state => state.sessions.find(s => s.id === sessionId));
  const policy = session?.metadata?.learning as { excluded?: boolean; includeAutomated?: boolean } | undefined;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error('Not connected');
      return client.http.sessions.setLearning(sessionId, { excluded: !policy?.excluded, includeAutomated: policy?.includeAutomated === true });
    },
    onSuccess: ({ session: updated }) => {
      useSessionStore.getState().updateSession(updated);
      toast.success('Learning eligibility saved. Existing knowledge is unchanged.');
    },
    onError: error => toast.error(error.message),
  });
  if (!session) return null;
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem disabled={mutation.isPending || !client} onSelect={event => { event.preventDefault(); mutation.mutate(); }}>
        {policy?.excluded ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        {policy?.excluded ? 'Allow future learning' : 'Exclude from learning'}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}
