import { useId } from 'react';
import type { ReactNode } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProkopaiClient, PullRequestScope } from '@prokopai/sdk';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface PullRequestContext {
  client: ProkopaiClient;
  serverId: string;
  workspaceId: string;
  scope: PullRequestScope;
  accountId: string;
  provider: 'github' | 'azure';
}
export function prKey(ctx: PullRequestContext): readonly unknown[] {
  return [
    'pull-requests',
    ctx.serverId,
    ctx.workspaceId,
    ctx.scope.repositoryKey,
    ctx.scope.remote,
    ctx.scope.root ?? '',
    ctx.accountId,
  ];
}
export function draftKey(ctx: PullRequestContext, number: number | 'create', field: string): string {
  return JSON.stringify([...prKey(ctx), number, field]);
}
interface Drafts {
  values: Record<string, string>;
  set(key: string, value: string): void;
}
export const usePrDrafts = create<Drafts>()(
  persist(
    (set) => ({
      values: {},
      set: (key, value) =>
        set((state) => {
          const values = { ...state.values };
          if (value) values[key] = value;
          else delete values[key];
          return { values };
        }),
    }),
    { name: 'prokop-pr-drafts', partialize: (state) => ({ values: state.values }) },
  ),
);

export function usePrDraft(key: string): [string, (value: string) => void, () => void] {
  const value = usePrDrafts((state) => state.values[key] ?? '');
  return [
    value,
    (value) => usePrDrafts.getState().set(key, value),
    () => {
      // A submitted draft can finish after navigation or edits in another mounted form.
      const store = usePrDrafts.getState();
      if ((store.values[key] ?? '') === value) store.set(key, '');
    },
  ];
}
export function PrError({ error }: { error: unknown }): ReactNode {
  return error ? (
    <Alert variant="destructive">
      <AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
    </Alert>
  ) : null;
}
export function PrSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
export function safePrUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
