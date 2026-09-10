import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { useSessionStore } from '@/stores/sessionStore';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { LearningHistory } from '@/components/modals/configuration/LearningHistory';

export function SessionLearningMenu({ sessionId }: { sessionId: string }) {
  const client = useSdkClient();
  const session = useSessionStore(state => state.sessions.find(s => s.id === sessionId));
  const [history, setHistory] = useState(false);
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
  return <>
    <DropdownMenuGroup>
      <DropdownMenuItem disabled={mutation.isPending || !client} onSelect={event => { event.preventDefault(); mutation.mutate(); }}>{policy?.excluded ? 'Allow future learning' : 'Exclude from learning'}</DropdownMenuItem>
      <DropdownMenuItem onSelect={event => { event.preventDefault(); setHistory(true); }}>Learning history</DropdownMenuItem>
    </DropdownMenuGroup>
    <Dialog open={history} onOpenChange={setHistory}>
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-2xl sm:max-h-[85vh]">
        <DialogHeader className="shrink-0"><DialogTitle>Learning history</DialogTitle><DialogDescription>Workspace reviews and revision-checked undo.</DialogDescription></DialogHeader>
        <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"><LearningHistory workspaceId={session.workspaceId} /></div>
      </DialogContent>
    </Dialog>
  </>;
}
