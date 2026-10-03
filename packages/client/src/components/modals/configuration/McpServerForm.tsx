import { useId, useState } from 'react';
import type { McpServerConfig } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function parsePairs(value: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of value.split('\n').filter(line => line.trim())) {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Use one NAME=value entry per line.');
    const name = line.slice(0, separator).trim();
    if (!name || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Invalid entry name.');
    pairs[name] = line.slice(separator + 1);
  }
  return pairs;
}
const formatPairs = (value?: Record<string, string>): string => Object.entries(value ?? {}).map(([key, value]) => key + '=' + value).join('\n');

export function McpServerForm({ name: originalName, config, names, pending, onSave, onCancel }: {
  name?: string; config?: McpServerConfig; names: string[]; pending: boolean;
  onSave(name: string, config: McpServerConfig): Promise<void>; onCancel(): void;
}) {
  const id = useId();
  const [name, setName] = useState(originalName ?? '');
  const [type, setType] = useState<'local' | 'remote'>(config?.type ?? 'remote');
  const [url, setUrl] = useState(config?.type === 'remote' ? config.url : '');
  const [command, setCommand] = useState(config?.type === 'local' ? config.command[0] : '');
  const [args, setArgs] = useState(config?.type === 'local' ? config.command.slice(1).join('\n') : '');
  const [env, setEnv] = useState(config?.type === 'local' ? formatPairs(config.env) : '');
  const [headers, setHeaders] = useState(config?.type === 'remote' ? formatPairs(config.headers) : '');
  const initialOAuth = config?.type === 'remote' && typeof config.oauth === 'object' ? config.oauth : {};
  const [oauth, setOauth] = useState(config?.type !== 'remote' || config.oauth !== false);
  const [clientId, setClientId] = useState(initialOAuth.clientId ?? '');
  const [clientSecret, setClientSecret] = useState(initialOAuth.clientSecret ?? '');
  const [scope, setScope] = useState(initialOAuth.scope ?? '');
  const [error, setError] = useState<string>();
  return <form className="flex flex-col gap-4 rounded-lg border p-3" onSubmit={async event => {
    event.preventDefault();
    setError(undefined);
    try {
      const trimmed = name.trim();
      if (!trimmed || !originalName && names.includes(trimmed)) throw new Error('Choose a unique server name.');
      const common = { enabled: config?.enabled ?? true, disabledTools: config?.disabledTools ?? [], timeout: config?.timeout };
      const next: McpServerConfig = type === 'local'
        ? { ...common, type, command: [command.trim(), ...args.split('\n').filter(Boolean)], env: parsePairs(env) }
        : { ...common, type, url: url.trim(), headers: parsePairs(headers),
          oauth: oauth ? { ...(clientId ? { clientId } : {}), ...(clientSecret ? { clientSecret } : {}), ...(scope ? { scope } : {}) } : false };
      await onSave(trimmed, next);
    } catch (error: unknown) { setError(error instanceof Error ? error.message : 'Unable to save server'); }
  }}>
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-3 text-sm font-medium">{originalName ? 'Edit server' : 'Add MCP server'}</legend>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id + '-name'}>Name</Label>
        <Input id={id + '-name'} value={name} disabled={!!originalName} required maxLength={100}
          placeholder="e.g. Pipedream" onChange={event => setName(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id + '-type'}>Connection</Label>
        <Select value={type} onValueChange={value => setType(value as 'local' | 'remote')}>
          <SelectTrigger id={id + '-type'}><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="remote">Remote URL</SelectItem>
            <SelectItem value="local">Local command</SelectItem></SelectGroup></SelectContent>
        </Select>
      </div>
      {type === 'remote' ? <>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id + '-url'}>MCP server URL</Label>
          <Input id={id + '-url'} type="url" required placeholder="https://example.com/mcp" value={url}
            onChange={event => setUrl(event.target.value)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id + '-oauth'}>Sign in with OAuth</Label>
          <Switch id={id + '-oauth'} checked={oauth} onCheckedChange={setOauth} />
        </div>
        <details><summary className="cursor-pointer text-sm text-muted-foreground">Authentication details</summary>
          <div className="mt-3 flex flex-col gap-3">
            {oauth && <>
              <p className="text-xs text-muted-foreground">Leave client details empty if the server supports automatic registration.</p>
              <Label htmlFor={id + '-client'}>Client ID</Label>
              <Input id={id + '-client'} value={clientId} onChange={event => setClientId(event.target.value)} />
              <Label htmlFor={id + '-secret'}>Client secret</Label>
              <Input id={id + '-secret'} type="password" autoComplete="new-password" value={clientSecret}
                onChange={event => setClientSecret(event.target.value)} />
              <Label htmlFor={id + '-scope'}>OAuth scopes</Label>
              <Input id={id + '-scope'} value={scope} onChange={event => setScope(event.target.value)} />
            </>}
            <Label htmlFor={id + '-headers'}>Headers (one NAME=value per line)</Label>
            <Textarea id={id + '-headers'} value={headers} placeholder="Authorization=Bearer …"
              onChange={event => setHeaders(event.target.value)} />
          </div>
        </details>
      </> : <>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id + '-command'}>Executable</Label>
          <Input id={id + '-command'} required value={command} placeholder="npx" onChange={event => setCommand(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id + '-args'}>Arguments (one per line)</Label>
          <Textarea id={id + '-args'} value={args} placeholder={'-y\npackage-name'} onChange={event => setArgs(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id + '-env'}>Environment (one NAME=value per line)</Label>
          <Textarea id={id + '-env'} value={env} onChange={event => setEnv(event.target.value)} />
        </div>
      </>}
    </fieldset>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex gap-2">
      <Button size="sm" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save server'}</Button>
      <Button size="sm" type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
    </div>
  </form>;
}
