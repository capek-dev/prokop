import { Copy, Check, X, Clock, Undo2, GitBranch, Pin, PinOff, Pencil, X as XIcon, Loader2 } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { Message } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { cn } from '@/lib/utils';

interface MessageBubbleProps {
  message: Message;
  textContent?: string;
  children?: React.ReactNode;
  isQueued?: boolean;
  onRemove?: () => void;
  onRevert?: () => void;
  canRevert?: boolean;
  onFork?: () => void;
  canFork?: boolean;
  onEdit?: (content: string) => void;
  canEdit?: boolean;
  isClearAll?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  canPin?: boolean;
  isPinningMessage?: boolean;
}

export function MessageBubble({
  message,
  textContent,
  children,
  isQueued = false,
  onRemove,
  onRevert,
  canRevert = false,
  onFork,
  canFork = false,
  onEdit,
  canEdit = false,
  isClearAll = false,
  isPinned = false,
  onTogglePin,
  canPin = false,
  isPinningMessage = false,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);
  const [showForkConfirm, setShowForkConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === 'user';

  const sessionId = message.sessionId;
  const isForking = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'fork' && op.messageId === message.id),
  );
  const isReverting = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'revert' && op.messageId === message.id),
  );
  const isEditingPending = usePendingOperationsStore((s) =>
    s.operations.some((op) => op.sessionId === sessionId && op.type === 'edit' && op.messageId === message.id),
  );

  useEffect(() => {
    if (isEditing && editTextareaRef.current) {
      editTextareaRef.current.focus();
      editTextareaRef.current.setSelectionRange(
        editTextareaRef.current.value.length,
        editTextareaRef.current.value.length,
      );
      const textarea = editTextareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 250)}px`;
    }
  }, [isEditing]);

  const handleCopy = async () => {
    const text = textContent || '';
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartEdit = () => {
    setEditText(textContent || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditText('');
  };

  const handleSaveEdit = () => {
    const trimmed = editText.trim();
    if (!trimmed || !onEdit) return;
    onEdit(trimmed);
  };

  useEffect(() => {
    if (isEditingPending) {
      setIsEditing(false);
    }
  }, [isEditingPending]);

  const handleEditKeydown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  const handleEditTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditText(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 250)}px`;
  };

  const showPinButton = canPin && onTogglePin && !isQueued;
  const showEditButton = canEdit && onEdit && !isQueued && isUser;
  const showAssistantFork = message.role === 'assistant' && canFork && Boolean(onFork);

  const renderAssistantActions = () => (
    <>
      {showAssistantFork && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowForkConfirm(true)}
          disabled={isForking}
          className="size-5 text-muted-foreground hover:text-foreground"
          title="Fork from this response"
        >
          {isForking ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <GitBranch className="size-3" />
          )}
        </Button>
      )}
      {showPinButton && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onTogglePin}
          disabled={isPinningMessage}
          className={cn(
            'size-5',
            isPinned
              ? 'text-primary hover:text-primary/80'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title={isPinningMessage ? 'Updating...' : isPinned ? 'Unpin message' : 'Pin message'}
        >
          {isPinningMessage ? (
            <Loader2 className="size-3 animate-spin" />
          ) : isPinned ? (
            <PinOff className="size-3" />
          ) : (
            <Pin className="size-3" />
          )}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleCopy}
        className="size-5 text-muted-foreground hover:text-foreground"
        title="Copy response"
      >
        {copied ? (
          <Check className="size-3" />
        ) : (
          <Copy className="size-3" />
        )}
      </Button>
    </>
  );

  return (
    <div
      className={cn(
        'group/msg flex flex-col gap-0.5 animate-slide-up min-w-0',
        isUser ? 'items-end' : 'items-stretch'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1 text-[10px] font-medium text-muted-foreground/70',
          isUser ? 'mr-1' : 'ml-1'
        )}
      >
        {isUser ? (
          <>
            <span>You</span>
            <span
              className={cn(
                'ml-auto flex items-center gap-0.5',
                'opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
              )}
            >
              {!isQueued && (
                <>
                  {canRevert && onRevert && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowRevertConfirm(true)}
                      className="size-5 text-muted-foreground hover:text-foreground"
                      title="Revert to this point"
                    >
                      <Undo2 className="size-3" />
                    </Button>
                  )}
                  {canFork && onFork && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowForkConfirm(true)}
                      className="size-5 text-muted-foreground hover:text-foreground"
                      title="Fork from this point"
                    >
                      <GitBranch className="size-3" />
                    </Button>
                  )}
                  {showEditButton && !isEditing && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleStartEdit}
                      className="size-5 text-muted-foreground hover:text-foreground"
                      title="Edit and resubmit"
                    >
                      <Pencil className="size-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    className="size-5 text-muted-foreground hover:text-foreground"
                    title="Copy message"
                  >
                    {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  </Button>
                </>
              )}
            </span>
          </>
        ) : (
          <span>Assistant</span>
        )}
      </div>

      {isEditing && isUser ? (
        <div className="w-full max-w-[90%] self-end">
          <div className="flex items-center gap-1.5 text-xs text-primary mb-1.5 mr-3 justify-end">
            <Pencil className="size-3" />
            Editing
          </div>
          <Textarea
            ref={editTextareaRef}
            value={editText}
            onChange={handleEditTextChange}
            onKeyDown={handleEditKeydown}
            className="rounded-2xl rounded-br-md bg-background border-2 border-primary/40 text-foreground resize-none min-h-[60px] shadow-lg shadow-primary/5 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <div className="flex items-center justify-end gap-2 mt-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelEdit}
              className="h-7 text-xs gap-1"
            >
              <XIcon className="size-3" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEdit}
              disabled={!editText.trim()}
              className="h-7 text-xs gap-1"
            >
              <Check className="size-3" />
              Send
            </Button>
          </div>
        </div>
      ) : isEditingPending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground self-end mr-3 animate-fade-in">
          <Loader2 className="size-3 animate-spin" />
          Applying edit...
        </div>
      ) : (
        <div
          className={cn(
            'relative group min-w-0 overflow-hidden',
            isUser
              ? isQueued
                ? 'rounded-2xl px-4 py-3 max-w-[90%] bg-muted text-foreground border-2 border-dashed border-muted-foreground/30 opacity-80 rounded-br-md'
                : 'rounded-2xl px-4 py-3 max-w-[90%] bg-primary text-primary-foreground rounded-br-md'
              : 'w-full overflow-visible'
          )}
        >
          {isQueued && (
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-muted-foreground/20">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3 animate-pulse" />
                <span>Pending</span>
              </div>
              {onRemove && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onRemove}
                  className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Remove from queue"
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          )}
          <div className="min-w-0">
            {children}
          </div>
        </div>
      )}

      {showAssistantFork && (
        <div className="flex items-center gap-0.5 pt-0.5">
          {showPinButton && isPinned && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onTogglePin}
              disabled={isPinningMessage}
              className="size-6 text-primary hover:text-primary/80"
              title="Unpin message"
            >
              {isPinningMessage ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <PinOff className="size-3" />
              )}
            </Button>
          )}
          <span
            className={cn(
              'flex items-center gap-0.5',
              'opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
            )}
          >
            {renderAssistantActions()}
          </span>
        </div>
      )}

      <ConfirmationDialog
        open={showRevertConfirm || isReverting}
        onOpenChange={(open) => { if (!isReverting) setShowRevertConfirm(open); }}
        title={isClearAll ? 'Clear Conversation' : 'Revert Conversation'}
        description={
          isClearAll
            ? 'This will delete all messages in this session, leaving it completely empty. Are you sure you want to continue?'
            : 'This will delete this message and all messages after it. Are you sure you want to continue?'
        }
        confirmLabel={isClearAll ? 'Clear All' : 'Revert'}
        cancelLabel="Cancel"
        onConfirm={() => {
          onRevert?.();
        }}
        variant="destructive"
        loading={isReverting}
      />

      <ConfirmationDialog
        open={showForkConfirm || isForking}
        onOpenChange={(open) => { if (!isForking) setShowForkConfirm(open); }}
        title={isUser ? 'Fork Conversation' : 'Fork from this response?'}
        description={
          isUser
            ? 'This will create a new session with messages up to and including this point. The original session will be unchanged.'
            : 'Create a new session that includes this response and everything before it. The original session will remain unchanged.'
        }
        confirmLabel={isUser ? 'Fork' : 'Create fork'}
        cancelLabel="Cancel"
        onConfirm={() => {
          onFork?.();
        }}
        loading={isForking}
      />
    </div>
  );
}
