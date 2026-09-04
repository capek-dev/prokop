import { useId, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import type { GitWorktreeRef } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface WorktreeCreateFormProps {
  refs: GitWorktreeRef[];
  existingWorktreeNames: string[];
  refsLoading: boolean;
  pending: boolean;
  onCreate: (input: { name: string; branch: string }, complete: () => void) => void;
}

function suggestedWorktreeName(branchName: string, existingNames: string[]): string {
  if (!branchName) return '';
  const names = new Set(existingNames);
  if (!names.has(branchName)) return branchName;

  let suffix = 2;
  while (names.has(`${branchName}-${suffix}`)) suffix += 1;
  return `${branchName}-${suffix}`;
}

export function WorktreeCreateForm({
  refs,
  existingWorktreeNames,
  refsLoading,
  pending,
  onCreate,
}: WorktreeCreateFormProps) {
  const nameId = useId();
  const nameErrorId = useId();
  const branchId = useId();
  const branchErrorId = useId();
  const localRefs = refs.filter((option) => option.kind === 'local');
  const defaultBranch = localRefs.find((option) => !option.checkedOut)?.ref ?? '';
  const [selectedBranch, setSelectedBranch] = useState('');
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const branch = selectedBranch || defaultBranch;
  const selectedRef = localRefs.find((option) => option.ref === branch);
  const name = nameOverride
    ?? suggestedWorktreeName(selectedRef?.name ?? '', existingWorktreeNames);
  const trimmedName = name.trim();
  const nameConflict = existingWorktreeNames.includes(trimmedName);
  const branchCheckedOut = selectedRef?.checkedOut ?? false;
  const canCreate = Boolean(
    trimmedName
    && branch
    && !nameConflict
    && !branchCheckedOut
    && !pending,
  );

  const submit = () => {
    if (!canCreate) return;
    onCreate({ name: trimmedName, branch }, () => setNameOverride(null));
  };

  return (
    <div className="flex flex-col gap-3 text-left">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={branchId}>Create from</Label>
        <Select
          value={branch}
          onValueChange={(value) => {
            setSelectedBranch(value);
            setNameOverride(null);
          }}
          disabled={pending || refsLoading || localRefs.length === 0}
        >
          <SelectTrigger id={branchId} className="w-full">
            <SelectValue placeholder={refsLoading ? 'Loading branches...' : 'Select a local branch'} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Local branches</SelectLabel>
              {localRefs.map((option) => (
                <SelectItem key={option.ref} value={option.ref} disabled={option.checkedOut}>
                  {option.name}
                  {option.checkedOut ? ' (already checked out)' : ''}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {branchCheckedOut && (
          <p id={branchErrorId} role="alert" className="text-sm text-destructive">
            This branch is already checked out in another worktree.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>Worktree name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setNameOverride(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canCreate) submit();
          }}
          placeholder="my-worktree"
          disabled={pending || !branch}
          aria-invalid={nameConflict}
          aria-describedby={nameConflict ? nameErrorId : undefined}
        />
        {nameConflict && (
          <p id={nameErrorId} role="alert" className="text-sm text-destructive">
            A worktree named &quot;{trimmedName}&quot; already exists. Choose a different name.
          </p>
        )}
      </div>
      <Button onClick={submit} disabled={!canCreate}>
        {pending ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <Plus data-icon="inline-start" />
        )}
        Create worktree
      </Button>
    </div>
  );
}
