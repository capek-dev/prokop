import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { FileActionDialog } from './useFileActions';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface FileActionsDialogsProps {
  dialog: FileActionDialog;
  mutating: boolean;
  error: string | null;
  overwrite: boolean;
  renameConflict: boolean;
  onClose: () => void;
  submitCreate: (name: string) => void;
  submitRename: (to: string) => void;
  submitDelete: () => void;
  setOverwrite: (checked: boolean) => void;
}

/** Focus the input and select everything after the last '/'. */
function useSelectBasenameOnOpen(open: boolean, inputRef: React.RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    if (!open) return;
    // Double rAF: wait for Radix mount + focus trap before selecting.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const lastSlash = el.value.lastIndexOf('/');
        el.setSelectionRange(lastSlash + 1, el.value.length);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [open, inputRef]);
}

interface NameEntryFormProps {
  open: boolean;
  initialValue: string;
  label: string;
  helper: string;
  placeholder: string;
  submitLabel: string;
  mutating: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  footerExtra?: React.ReactNode;
}

function NameEntryForm({
  open,
  initialValue,
  label,
  helper,
  placeholder,
  submitLabel,
  mutating,
  error,
  onCancel,
  onSubmit,
  footerExtra,
}: NameEntryFormProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useSelectBasenameOnOpen(open, inputRef);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(value);
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="file-action-name">{label}</Label>
        <Input
          id="file-action-name"
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
      </div>
      {footerExtra}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutating}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutating}>
          {mutating && <Loader2 data-icon="inline-start" className="animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CreateFileDialog({
  dialog,
  mutating,
  error,
  onClose,
  submitCreate,
}: FileActionsDialogsProps) {
  const open = dialog?.type === 'create';
  const kind = dialog?.type === 'create' ? dialog.kind : 'file';
  const parentDirPath = dialog?.type === 'create' ? dialog.parentDirPath : '';
  const title = kind === 'directory' ? 'New Folder' : 'New File';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Created in {parentDirPath || 'the workspace root'} (missing parents are created automatically)
          </DialogDescription>
        </DialogHeader>
        <NameEntryForm
          open={open}
          initialValue=""
          label={kind === 'directory' ? 'Folder name' : 'File name'}
          helper=""
          placeholder={kind === 'directory' ? 'Folder name' : 'File name'}
          submitLabel={kind === 'directory' ? 'Create Folder' : 'Create File'}
          mutating={mutating}
          error={error}
          onCancel={onClose}
          onSubmit={submitCreate}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  dialog,
  mutating,
  error,
  overwrite,
  renameConflict,
  onClose,
  submitRename,
  setOverwrite,
}: FileActionsDialogsProps) {
  const open = dialog?.type === 'rename';
  const target = dialog?.type === 'rename' ? dialog.target : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.isDirectory ? 'Rename Folder' : 'Rename File'}</DialogTitle>
          <DialogDescription>
            Rename or move {target?.isDirectory ? 'folder' : 'file'} {target?.name ?? ''}. Paths are relative to the workspace root.
          </DialogDescription>
        </DialogHeader>
        <NameEntryForm
          open={open}
          initialValue={target?.path ?? ''}
          label="New path"
          helper=""
          placeholder="Relative path"
          submitLabel="Rename"
          mutating={mutating}
          error={error}
          onCancel={onClose}
          onSubmit={submitRename}
          footerExtra={
            renameConflict && target && !target.isDirectory ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={overwrite}
                  onCheckedChange={(checked) => setOverwrite(checked === true)}
                />
                Replace the existing destination file
              </label>
            ) : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  dialog,
  mutating,
  error,
  onClose,
  submitDelete,
}: FileActionsDialogsProps) {
  const open = dialog?.type === 'delete';
  const target = dialog?.type === 'delete' ? dialog.target : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.isDirectory ? 'Delete Folder' : 'Delete File'}</DialogTitle>
          <DialogDescription>
            {target?.isDirectory
              ? `Delete folder ${target.name} and all of its contents? This cannot be undone.`
              : `Delete file ${target?.name ?? ''}? This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutating}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submitDelete} disabled={mutating}>
            {mutating && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FileActionsDialogs(props: FileActionsDialogsProps) {
  return (
    <>
      <CreateFileDialog {...props} />
      <RenameDialog {...props} />
      <DeleteDialog {...props} />
    </>
  );
}
