import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useRecordHotkeys } from 'react-hotkeys-hook';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  bindingFromRecordedKeys,
  findKeybindingConflict,
  formatKeybinding,
  isReservedBrowserBinding,
  KEYBINDING_COMMANDS,
  resolveKeybinding,
  type KeybindingCommand,
  type KeybindingCommandId,
} from '@/lib/keybindings';
import { useKeybindingStore } from '@/stores/keybindingStore';

interface PendingAssignment {
  id: KeybindingCommandId;
  binding: string;
  conflict: KeybindingCommand | null;
  reserved: boolean;
}

const CATEGORIES = ['Navigation', 'Chat', 'Panes', 'Editor'] as const;
const ESCAPE_SEQUENCE_TIMEOUT_MS = 500;

export function KeybindsPanel() {
  const overrides = useKeybindingStore((state) => state.overrides);
  const setBinding = useKeybindingStore((state) => state.setBinding);
  const unsetBinding = useKeybindingStore((state) => state.unsetBinding);
  const resetBinding = useKeybindingStore((state) => state.resetBinding);
  const resetAllBindings = useKeybindingStore((state) => state.resetAllBindings);
  const [editingId, setEditingId] = useState<KeybindingCommandId | null>(null);
  const [pending, setPending] = useState<PendingAssignment | null>(null);
  const [escapePending, setEscapePending] = useState(false);
  const escapeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recordedKeys, { start, stop, resetKeys, isRecording }] = useRecordHotkeys();
  const recordedBinding = useMemo(
    () => bindingFromRecordedKeys(recordedKeys),
    [recordedKeys],
  );
  const hasOverrides = Object.keys(overrides).length > 0;

  const clearEscapeTimer = useCallback(() => {
    if (escapeTimerRef.current !== null) {
      clearTimeout(escapeTimerRef.current);
      escapeTimerRef.current = null;
    }
    setEscapePending(false);
  }, []);

  const cancelRecording = useCallback(() => {
    clearEscapeTimer();
    stop();
    resetKeys();
    setEditingId(null);
  }, [clearEscapeTimer, resetKeys, stop]);

  const finishRecording = useCallback((id: KeybindingCommandId, binding: string) => {
    clearEscapeTimer();
    stop();
    resetKeys();
    setEditingId(null);
    const assignment = {
      id,
      binding,
      conflict: findKeybindingConflict(id, binding, overrides),
      reserved: isReservedBrowserBinding(binding),
    };
    if (assignment.conflict || assignment.reserved) {
      setPending(assignment);
    } else {
      setBinding(id, binding);
    }
  }, [clearEscapeTimer, overrides, resetKeys, setBinding, stop]);

  useEffect(() => clearEscapeTimer, [clearEscapeTimer]);

  useEffect(() => {
    if (!editingId || !isRecording || !recordedBinding) return;
    if (recordedBinding === 'escape') {
      cancelRecording();
      return;
    }

    finishRecording(editingId, recordedBinding);
  }, [cancelRecording, editingId, finishRecording, isRecording, recordedBinding]);

  useEffect(() => {
    if (!editingId || !isRecording) return;

    const captureEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopImmediatePropagation();
      const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
      if (!hasModifier) {
        if (escapeTimerRef.current !== null) {
          finishRecording(editingId, 'escape>escape');
          return;
        }

        setEscapePending(true);
        escapeTimerRef.current = setTimeout(() => {
          escapeTimerRef.current = null;
          setEscapePending(false);
          finishRecording(editingId, 'escape');
        }, ESCAPE_SEQUENCE_TIMEOUT_MS);
        return;
      }

      const keys = new Set<string>(['escape']);
      if (event.altKey) keys.add('alt');
      if (event.ctrlKey) keys.add('ctrl');
      if (event.metaKey) keys.add('meta');
      if (event.shiftKey) keys.add('shift');
      const binding = bindingFromRecordedKeys(keys);
      if (binding) finishRecording(editingId, binding);
    };

    window.addEventListener('keydown', captureEscape, true);
    return () => window.removeEventListener('keydown', captureEscape, true);
  }, [cancelRecording, editingId, finishRecording, isRecording]);

  const startRecording = (id: KeybindingCommandId) => {
    clearEscapeTimer();
    resetKeys();
    setEditingId(id);
    start();
  };

  const confirmAssignment = () => {
    if (!pending) return;
    if (pending.conflict) unsetBinding(pending.conflict.id);
    setBinding(pending.id, pending.binding);
    setPending(null);
  };

  return (
    <div className="flex flex-col gap-5 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-medium">Keyboard shortcuts</h2>
          <p className="text-sm text-muted-foreground">
            Change application commands. Navigation inside individual widgets stays fixed.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasOverrides}
          onClick={resetAllBindings}
        >
          <RotateCcw data-icon="inline-start" />
          Reset all
        </Button>
      </div>

      <Alert>
        <AlertTriangle />
        <AlertTitle>Browser shortcuts can take priority</AlertTitle>
        <AlertDescription>
          Some browser and operating-system shortcuts cannot be captured by this page.
        </AlertDescription>
      </Alert>

      {CATEGORIES.map((category) => (
        <section key={category} className="flex flex-col gap-2" aria-labelledby={`keybindings-${category}`}>
          <h3 id={`keybindings-${category}`} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {category}
          </h3>
          <div className="divide-y rounded-md border">
            {KEYBINDING_COMMANDS.filter((command) => command.category === category).map((command) => {
              const binding = resolveKeybinding(command.id, overrides);
              const customized = Object.prototype.hasOwnProperty.call(overrides, command.id);
              const isEditing = editingId === command.id;
              const status = binding === null ? 'Unassigned' : customized ? 'Custom' : 'Default';

              return (
                <div
                  key={command.id}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{command.label}</span>
                      <Badge variant={customized ? 'secondary' : 'outline'}>{status}</Badge>
                    </div>
                    <div className="mt-1 min-h-7">
                      {isEditing ? (
                        <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
                          {escapePending
                            ? 'Press Escape again for a sequence'
                            : 'Press a shortcut. Use Cancel to stop recording.'}
                        </span>
                      ) : binding ? (
                        <kbd className="rounded bg-muted px-2 py-1 font-mono text-xs">
                          {formatKeybinding(binding)}
                        </kbd>
                      ) : (
                        <span className="text-sm text-muted-foreground">No shortcut</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {isEditing ? (
                      <Button type="button" variant="outline" size="xs" onClick={cancelRecording}>
                        Cancel
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => startRecording(command.id)}
                          aria-label={`Change ${command.label}`}
                        >
                          Change
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={binding === null}
                          onClick={() => unsetBinding(command.id)}
                          aria-label={`Unset ${command.label}`}
                        >
                          Unset
                        </Button>
                        {customized && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => resetBinding(command.id)}
                            aria-label={`Reset ${command.label}`}
                          >
                            Reset
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {pending?.conflict ? 'Replace existing shortcut?' : 'Assign browser shortcut?'}
            </DialogTitle>
            <DialogDescription>
              {pending?.conflict
                ? `${formatKeybinding(pending.binding)} is assigned to ${pending.conflict.label}. Replacing it will leave that command unassigned.`
                : `${pending ? formatKeybinding(pending.binding) : ''} is commonly reserved by the browser or operating system and might not reach Prokop.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmAssignment}>
              {pending?.conflict ? 'Replace' : 'Assign anyway'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
