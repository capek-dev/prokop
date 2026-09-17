import { useState } from 'react';
import { ChevronRight, Layers } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { SelectedContextItem, SelectedContextRecord } from '@prokopai/sdk';
import { useServerClient } from '@/contexts/ServerClientContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const OUTCOMES: Record<SelectedContextRecord['outcome'], string> = {
  selected: 'Context selected for this response.',
  disabled: 'Selection was disabled. Standard memory context used.',
  missing_credentials: 'TypeSafe credentials were missing. Standard memory context used.',
  missing_evidence: 'No usable task text. Standard memory context used.',
  timeout: 'Selection timed out. Standard memory context used.',
  failed: 'Selection failed. Standard memory context used.',
  input_limit: 'Candidate input exceeded the selection limit. Standard memory context used.',
};

function ContextItem({ item }: { item: SelectedContextItem }) {
  const [open, setOpen] = useState(false);
  return <div className="flex min-w-0 flex-col gap-2 py-3">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>{item.source === 'agent' ? 'Agent' : 'Workspace'}</span>
      {item.inclusion === 'always' && <span>Always included</span>}
      {item.inclusion === 'baseline' && <span>Standard context</span>}
      {item.score !== undefined && <span className="ml-auto tabular-nums" title="Relevance score out of 3">{item.score.toFixed(1)} / 3</span>}
    </div>
    {item.kind === 'skill' ? <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="max-w-full" aria-label={item.name}><ChevronRight data-icon="inline-start" className={open ? 'rotate-90' : ''} /><span className="truncate">{item.name}</span></Button></CollapsibleTrigger>
      {item.description && <p>{item.description}</p>}
      <CollapsibleContent>{open && <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs">{item.content}</pre>}</CollapsibleContent>
    </Collapsible> : <div className="min-w-0 break-words"><MarkdownRenderer>{item.content}</MarkdownRenderer></div>}
  </div>;
}

export function SelectedContextDetails({ record }: { record: SelectedContextRecord }) {
  const [technical, setTechnical] = useState(false);
  const memories = record.items.filter(item => item.kind === 'memory' && item.inclusion === 'selected').length;
  const skills = record.items.filter(item => item.kind === 'skill').length;
  return <div className="flex min-w-0 flex-col gap-5 text-sm">
    <p>{OUTCOMES[record.outcome]} {record.outcome === 'selected' && `${memories} memories selected · ${skills} skills preloaded.`}</p>
    <p className="text-muted-foreground">Assembled context, not proof that the provider received or followed it. Skills loaded later appear in tool calls.</p>
    {record.outcome === 'selected' && <p className="text-muted-foreground">Relevance scored by TypeSafe using task text and candidate content.</p>}
    {record.continuation && <p>Compaction continuation, with its own context snapshot.</p>}
    {(['memory', 'skill', 'preferences'] as const).map(kind => {
      const items = record.items.filter(item => item.kind === kind);
      if (!items.length) return null;
      return <section key={kind} className="min-w-0" aria-label={kind === 'memory' ? 'Memories' : kind === 'skill' ? 'Skills' : 'Preferences'}>
        <h3 className="flex items-center gap-2 font-medium">{kind === 'memory' ? 'Memories' : kind === 'skill' ? 'Skills' : 'Preferences'}<Badge variant="secondary">{items.length}</Badge></h3>
        <div className="divide-y">{items.map(item => <ContextItem key={item.id} item={item} />)}</div>
      </section>;
    })}
    {record.items.length === 0 && <p>No memory, preferences, or skill bodies were included by this assembler.</p>}
    <Collapsible open={technical} onOpenChange={setTechnical}>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm">Technical details</Button></CollapsibleTrigger>
      <CollapsibleContent>{technical && <div className="flex flex-col gap-2 py-3 text-xs text-muted-foreground">
        <p>Threshold: {record.threshold} · Selection: {record.elapsedMs} ms · {record.createdAt}</p>
        <p className="break-all">Response: {record.assistantMessageId}</p>
        {record.items.map(item => <p className="break-all" key={item.id}>{item.name}{item.score !== undefined ? ` · score ${item.score.toFixed(2)}` : ''}: revision {item.revision}</p>)}
        {record.excluded.map(item => <p key={item.id}>{item.source} · {item.name} · {item.score.toFixed(2)} · {item.reason === 'budget' ? 'Excluded by budget' : 'Below threshold'}</p>)}
      </div>}</CollapsibleContent>
    </Collapsible>
  </div>;
}

function SelectedContextQuery({ sessionId, messageId }: { sessionId: string; messageId: string }) {
  const { sdkClient, serverUrl } = useServerClient();
  const query = useQuery({
    queryKey: ['selected-context', serverUrl, sessionId, messageId],
    queryFn: ({ signal }) => {
      if (!sdkClient) throw new Error('Server unavailable');
      return sdkClient.http.sessions.getSelectedContext(sessionId, messageId, { signal });
    },
    enabled: Boolean(sdkClient), staleTime: Infinity, gcTime: 0,
  });
  if (query.isError) return <div role="alert">Could not load selected context. <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>;
  if (!query.data) return <p role="status">Loading selected context…</p>;
  if (!query.data.record) return <p>No context snapshot was recorded for this response.</p>;
  return <SelectedContextDetails record={query.data.record} />;
}

/** No request or body mounting until the dialog opens. Records precede message.created. */
export function SelectedContext({ sessionId, messageId }: { sessionId: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <span className="text-muted-foreground">
      <DialogTrigger asChild><Button variant="ghost" size="xs" aria-label="Selected context"><Layers data-icon="inline-start" />Context</Button></DialogTrigger>
    </span>
    <DialogContent className="flex flex-col overflow-hidden p-3 sm:max-w-2xl sm:max-h-[85vh] sm:p-5">
      <DialogHeader className="shrink-0 pr-8">
        <DialogTitle>Selected context</DialogTitle>
        <DialogDescription>Memory and skills assembled for this response.</DialogDescription>
      </DialogHeader>
      <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
        {open && <SelectedContextQuery key={`${sessionId}:${messageId}`} sessionId={sessionId} messageId={messageId} />}
      </div>
    </DialogContent>
  </Dialog>;
}
