import { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { ArrowUp, Square, Paperclip, AlertTriangle, Target, ChevronDown } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { FileEntry, PromptInfo, AttachmentKind } from '@prokopai/sdk';
import { FileAutocomplete } from '@/components/files/FileAutocomplete';
import { PromptAutocomplete } from '@/components/chat/PromptAutocomplete';
import { PendingAttachment } from './PendingAttachment';
import { FileMentionChip } from './FileMentionChip';
import { AutoApproveSelector } from './AutoApproveSelector';
import { ResponseFormatSelector } from './ResponseFormatSelector';
import { useResponseFormatsQuery } from '@/hooks/queries';
// import { useHighlightBackground } from '@/hooks/useHighlightBackground';
import { useFileSearch, extractMentionsFromText } from '@/hooks/useFileSearch';
import { useSessionDraft } from '@/hooks/useSessionDraft';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';

type AutocompleteMode = 'none' | 'files' | 'prompts';

interface MessageInputProps {
  onSendMessage: (content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string, goal?: { condition: string; maxTurns?: number }) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  onStopStreaming?: () => void;
  placeholder?: string;
  workspaceId?: string;
  sdkClient?: ProkopaiClient | null;
  prompts?: PromptInfo[];
  sessionId?: string;
  modelSupportsImage?: boolean;
  goalState?: import('@prokopai/sdk').GoalState | null;
}

interface PendingAttachmentData {
  id: string;
  kind: AttachmentKind;
  filename: string;
  size: number;
  previewUrl?: string;
  uploadedId?: string;
  uploadedKind?: AttachmentKind;
  isUploading?: boolean;
}

export interface MessageInputHandle {
  focus: () => void;
}

function expandPromptContent(prompt: PromptInfo, userText: string): string {
  if (userText) {
    if (prompt.content.includes('ARG')) {
      return prompt.content.replace('ARG', userText);
    }
    return `${prompt.content}\n${userText}`;
  }
  return prompt.content;
}

function extractPromptCommand(input: string): { command: string; rest: string } | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { command: trimmed.slice(1), rest: '' };
  }
  return { command: trimmed.slice(1, spaceIndex), rest: trimmed.slice(spaceIndex + 1).trim() };
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(function MessageInput({
  onSendMessage,
  disabled,
  isStreaming,
  onStopStreaming,
  placeholder = 'Type a message...',
  workspaceId,
  sdkClient,
  prompts = [],
  sessionId,
  modelSupportsImage,
  goalState,
}: MessageInputProps, ref) {
  const { input, setInput, clearInput } = useSessionDraft(sessionId);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [autocompleteFiles, setAutocompleteFiles] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [acMode, setAcMode] = useState<AutocompleteMode>('none');
  const [tooltipIndex, setTooltipIndex] = useState<number | null>(null);
  const [promptQuery, setPromptQuery] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentData[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedResponseFormatId, setSelectedResponseFormatId] = useState<string | undefined>(undefined);
  const [sendMode, setSendMode] = useState<'chat' | 'goal'>('chat');
  const [goalMaxTurns, setGoalMaxTurns] = useState(5);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastEscRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: responseFormatsData } = useResponseFormatsQuery(sdkClient ?? null);
  const responseFormats = responseFormatsData?.formats ?? [];

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }), []);

  const {
    query,
    setQuery,
    showAutocomplete,
    setShowAutocomplete,
    handleFileSelect,
    insertMention,
  } = useFileSearch({ workspaceId: workspaceId || '' });

  const mentions = useMemo(() => extractMentionsFromText(input), [input]);

  const openFilePreview = useUIStore((s) => s.openFilePreview);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  // Disabled: canvas background highlight overlay was not working well
  // const mentionPaths = useMemo(() => mentions.map(m => m.path), [mentions]);
  // useHighlightBackground(textareaRef, input, mentionPaths);

  useEffect(() => {
    setSelectedIndex(0);
    setTooltipIndex(null);
  }, [autocompleteFiles, promptQuery, prompts]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [input]);

  const filteredPrompts = prompts.filter(p =>
    p.name.toLowerCase().includes(promptQuery.toLowerCase())
  );

  const showPromptAc = acMode === 'prompts' && prompts.length > 0;
  const showFileAc = acMode === 'files' && showAutocomplete && !!workspaceId;

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    setInput(value);
    setCursorPosition(cursorPos);

    const lastSlashIndex = value.lastIndexOf('/', cursorPos);
    if (lastSlashIndex !== -1) {
      const charBefore = lastSlashIndex > 0 ? value[lastSlashIndex - 1] : '\n';
      const textAfterSlash = value.slice(lastSlashIndex + 1, cursorPos);

      if ((charBefore === '\n' || charBefore === ' ' || charBefore === '') && !textAfterSlash.includes(' ')) {
        setPromptQuery(textAfterSlash);
        setAcMode('prompts');
        return;
      }
    }

    const lastAtIndex = value.lastIndexOf('@', cursorPos);
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1, cursorPos);
      if (!textAfterAt.includes(' ')) {
        setQuery(textAfterAt);
        setShowAutocomplete(true);
        setAcMode('files');
        return;
      }
    }

    setAcMode('none');
    setShowAutocomplete(false);
  }, [setQuery, setShowAutocomplete, setInput]);

  const handleFileSelectWrapper = useCallback((file: FileEntry) => {
    const mention = handleFileSelect(file);
    const result = insertMention(input, cursorPosition, mention);
    setInput(result.text);
    setAcMode('none');
    setShowAutocomplete(false);
    setAutocompleteFiles([]);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(result.cursorPos, result.cursorPos);
      }
    }, 0);
  }, [input, cursorPosition, handleFileSelect, insertMention, setShowAutocomplete, setInput]);

  const handlePromptSelect = useCallback((prompt: PromptInfo) => {
    const lastSlashIndex = input.lastIndexOf('/', cursorPosition);
    const beforeSlash = input.slice(0, lastSlashIndex);
    const afterSlash = input.slice(lastSlashIndex + 1);
    const spaceIndex = afterSlash.indexOf(' ');
    const existingUserText = spaceIndex !== -1 ? afterSlash.slice(spaceIndex) : '';

    const completed = `${beforeSlash}/${prompt.name}${existingUserText}`;
    const newCursorPos = lastSlashIndex + 1 + prompt.name.length + (existingUserText ? 0 : 0);

    setInput(completed);
    setAcMode('none');

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  }, [input, cursorPosition, setInput]);

  const cleanupPending = useCallback(() => {
    for (const a of pendingAttachments) {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    }
    setPendingAttachments([]);
    clearInput();
  }, [pendingAttachments, clearInput]);

  const uploadAttachment = useCallback(async (file: File): Promise<PendingAttachmentData | null> => {
    if (!sdkClient || !sessionId) return null;

    try {
      const attachment = await sdkClient?.http.attachments.upload(sessionId, file);

      return {
        id: crypto.randomUUID(),
        kind: attachment.kind as AttachmentKind,
        filename: attachment.filename,
        size: attachment.size,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        uploadedId: attachment.id,
        uploadedKind: attachment.kind as AttachmentKind,
      };
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  }, [sdkClient, sessionId]);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => {
      const item = prev.find(a => a.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const handleMentionRemove = useCallback((path: string) => {
    const escapedPath = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionRegex = new RegExp(`@${escapedPath}`, 'g');
    const newInput = input.replace(mentionRegex, '').replace(/\s+/g, ' ').trim();
    setInput(newInput);
  }, [input, setInput]);

  const handleMentionPreview = useCallback((path: string) => {
    if (activeWorkspace?.id) {
      openFilePreview({
        workspaceId: activeWorkspace.id,
        path,
        name: path.split('/').pop() || path,
      });
    }
  }, [activeWorkspace?.id, openFilePreview]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      if (file.size > 20 * 1024 * 1024) continue;

      const localKind = file.type.startsWith('image/') ? 'image' as const
        : file.type.startsWith('video/') ? 'video' as const
        : 'file' as const;

      const previewItem: PendingAttachmentData = {
        id: crypto.randomUUID(),
        kind: localKind,
        filename: file.name,
        size: file.size,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        isUploading: true,
      };
      setPendingAttachments(prev => [...prev, previewItem]);

      const result = await uploadAttachment(file);
      if (result) {
        setPendingAttachments(prev => prev.map(a => {
          if (a.id === previewItem.id) {
            if (a.previewUrl && a.previewUrl !== result.previewUrl) {
              URL.revokeObjectURL(a.previewUrl);
            }
            return { ...result, isUploading: false };
          }
          return a;
        }));
      } else {
        setPendingAttachments(prev => prev.filter(a => a.id !== previewItem.id));
      }
    }
  }, [uploadAttachment]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      addFiles(files);
    }
  }, [addFiles]);

  const goalActive = goalState?.status === 'active';
  const effectiveDisabled = disabled || goalActive;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && pendingAttachments.length === 0) || effectiveDisabled) return;

    if (sendMode === 'goal') {
      onSendMessage(trimmed, undefined, undefined, { condition: trimmed, maxTurns: goalMaxTurns });
      cleanupPending();
      setSelectedResponseFormatId(undefined);
      setSendMode('chat');
      return;
    }

    const parsed = extractPromptCommand(input);
    if (parsed) {
      const prompt = prompts.find(p => p.name === parsed.command);
      if (prompt) {
        const expanded = expandPromptContent(prompt, parsed.rest);
        const uploadedAttachments = pendingAttachments
          .filter(a => a.uploadedId)
          .map(a => ({ id: a.uploadedId!, kind: a.uploadedKind! }));
        onSendMessage(expanded, uploadedAttachments.length > 0 ? uploadedAttachments : undefined, selectedResponseFormatId);
        cleanupPending();
        setSelectedResponseFormatId(undefined);
        return;
      }
    }

    const uploadedAttachments = pendingAttachments
      .filter(a => a.uploadedId)
      .map(a => ({ id: a.uploadedId!, kind: a.uploadedKind! }));
    onSendMessage(trimmed || '', uploadedAttachments.length > 0 ? uploadedAttachments : undefined, selectedResponseFormatId);
    cleanupPending();
    setSelectedResponseFormatId(undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (showPromptAc && filteredPrompts.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, filteredPrompts.length - 1));
          return;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          return;
        case 'Enter':
          if (e.shiftKey) return;
          e.preventDefault();
          if (filteredPrompts[selectedIndex]) {
            handlePromptSelect(filteredPrompts[selectedIndex]);
          }
          return;
        case 'Tab':
          e.preventDefault();
          if (filteredPrompts[selectedIndex]) {
            handlePromptSelect(filteredPrompts[selectedIndex]);
          }
          return;
        case 'Escape':
          e.preventDefault();
          setAcMode('none');
          return;
      }
    }

    if (showFileAc && autocompleteFiles.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(i => Math.min(i + 1, autocompleteFiles.length - 1));
          return;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(i => Math.max(i - 1, 0));
          return;
        case 'Enter':
          e.preventDefault();
          if (autocompleteFiles[selectedIndex]) {
            handleFileSelectWrapper(autocompleteFiles[selectedIndex]);
          }
          return;
        case 'ArrowRight':
          e.preventDefault();
          setTooltipIndex(selectedIndex);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          setTooltipIndex(null);
          return;
        case 'Escape':
          e.preventDefault();
          setShowAutocomplete(false);
          setAcMode('none');
          setTooltipIndex(null);
          return;
        case 'Tab':
          e.preventDefault();
          if (autocompleteFiles[selectedIndex]) {
            handleFileSelectWrapper(autocompleteFiles[selectedIndex]);
          }
          setTooltipIndex(null);
          return;
      }
    }

    if (e.key === 'Escape' && isStreaming && onStopStreaming) {
      const now = Date.now();
      if (now - lastEscRef.current < 500) {
        e.preventDefault();
        onStopStreaming();
        lastEscRef.current = 0;
      } else {
        lastEscRef.current = now;
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFilesChange = useCallback((files: FileEntry[]) => {
    setAutocompleteFiles(files);
  }, []);

  const trimmed = input.trim();
  const hasUploadingAttachment = pendingAttachments.some(a => a.isUploading);
  const canSend = trimmed || pendingAttachments.length > 0;
  const isDisabled = !canSend || disabled || hasUploadingAttachment || goalActive;
  const effectivePlaceholder = goalActive
    ? `Goal active: ${goalState?.condition ?? ''} (Turn ${goalState?.currentTurn ?? 0}/${goalState?.maxTurns ?? 0})`
    : sendMode === 'goal'
      ? 'Type the completion condition...'
      : placeholder;

  return (
    <form
      onSubmit={handleSubmit}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'px-4 pt-2 pb-3 bg-background',
        isDragOver && 'ring-2 ring-primary'
      )}
    >
      <div
        className={cn(
          'rounded-xl bg-input/30 overflow-hidden',
          'focus-within:ring-1 focus-within:ring-ring/40',
          'transition-shadow',
          'border border-border',
          isDragOver && 'ring-2 ring-primary border-primary'
        )}
      >
        {pendingAttachments.length > 0 && (
          <div className="flex gap-2 flex-wrap px-3 pt-3">
            {pendingAttachments.map(a => (
              <PendingAttachment
                key={a.id}
                id={a.id}
                kind={a.kind}
                filename={a.filename}
                size={a.size}
                previewUrl={a.previewUrl}
                isUploading={a.isUploading}
                onRemove={removeAttachment}
              />
            ))}
          </div>
        )}
        {pendingAttachments.length > 0 && modelSupportsImage === false && (
          <div className="flex items-center gap-1.5 px-3 pt-2 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3 shrink-0" />
            <span>This model will not inspect images directly. They will be sent as file paths instead.</span>
          </div>
        )}
        {mentions.length > 0 && (
          <div className="flex gap-2 flex-wrap px-3 pt-2">
            {mentions.map((mention) => (
              <FileMentionChip
                key={mention.path}
                path={mention.path}
                onRemove={handleMentionRemove}
                onPreview={handleMentionPreview}
              />
            ))}
          </div>
        )}
        <div className="relative">
          <Popover open={showPromptAc || showFileAc} onOpenChange={(open) => {
            if (!open) {
              setAcMode('none');
              setShowAutocomplete(false);
              setTooltipIndex(null);
            }
          }}>
            <PopoverAnchor asChild>
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={effectivePlaceholder}
                disabled={disabled || goalActive}
                className={cn(
                  'min-h-[52px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent shadow-none',
                  'px-3 pt-3 pb-0 chat-input-scrollbar',
                  'focus-visible:ring-0 focus-visible:shadow-none',
                  'placeholder:text-muted-foreground/60',
                  'disabled:bg-transparent disabled:opacity-100 dark:disabled:bg-transparent'
                )}
                rows={1}
                data-chat-input="true"
              />
            </PopoverAnchor>

            <PopoverContent
              className={cn('p-0', showFileAc ? 'w-96' : 'w-72')}
              align="start"
              side="top"
              sideOffset={8}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {showFileAc ? (
                <TooltipProvider>
                <FileAutocomplete
                  workspaceId={workspaceId || ''}
                  searchQuery={query}
                  selectedIndex={selectedIndex}
                  tooltipIndex={tooltipIndex}
                  onTooltipIndexChange={setTooltipIndex}
                  onSelect={handleFileSelectWrapper}
                  onFilesChange={handleFilesChange}
                  sdkClient={sdkClient}
                />
                </TooltipProvider>
              ) : (
                <PromptAutocomplete
                  prompts={prompts}
                  query={promptQuery}
                  selectedIndex={selectedIndex}
                  onSelect={handlePromptSelect}
                />
              )}
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex items-center justify-center size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:pointer-events-none"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label="Attach file"
            >
              <Paperclip className="size-4" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,.pdf,.doc,.docx,.txt,.csv,.json,.xml,.md"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {sessionId && (
              <>
                <AutoApproveSelector
                  sessionId={sessionId}
                  sdkClient={sdkClient ?? null}
                  disabled={disabled}
                />
                <ResponseFormatSelector
                  formats={responseFormats}
                  selectedId={selectedResponseFormatId}
                  onSelect={setSelectedResponseFormatId}
                  disabled={disabled}
                />
              </>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">/</kbd>
            <span>prompts</span>
            <span className="mx-1">•</span>
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-[10px]">@</kbd>
            <span>files</span>
          </div>

          <div className="flex h-8 items-center rounded-full border border-border">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={goalActive}
                  className="flex h-full items-center gap-0.5 rounded-l-full bg-muted pl-2.5 pr-1 text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  aria-label="Send mode"
                >
                  <span className="text-xs font-medium capitalize">{sendMode}</span>
                  <ChevronDown className="size-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-56">
                <DropdownMenuLabel>Send Mode</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => setSendMode('chat')}
                >
                  <ArrowUp className="size-4 mr-2" />
                  <span>Chat</span>
                  {sendMode === 'chat' && <span className="ml-auto text-xs">✓</span>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => setSendMode('goal')}
                >
                  <Target className="size-4 mr-2" />
                  <span>Goal</span>
                  {sendMode === 'goal' && <span className="ml-auto text-xs">✓</span>}
                </DropdownMenuItem>
                {sendMode === 'goal' && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">Max turns</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="flex items-center justify-center size-5 rounded bg-muted text-foreground hover:bg-accent text-xs"
                          onClick={() => setGoalMaxTurns(Math.max(1, goalMaxTurns - 1))}
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-xs tabular-nums">{goalMaxTurns}</span>
                        <button
                          type="button"
                          className="flex items-center justify-center size-5 rounded bg-muted text-foreground hover:bg-accent text-xs"
                          onClick={() => setGoalMaxTurns(Math.min(100, goalMaxTurns + 1))}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {isStreaming && onStopStreaming && !canSend ? (
              <button
                type="button"
                onClick={onStopStreaming}
                className="flex h-full items-center justify-center rounded-r-full border-l border-border bg-muted px-2.5 text-red-600 transition-colors hover:bg-accent dark:text-red-400"
                aria-label="Stop"
                title="Stop (double Esc)"
              >
                <Square className="size-4" fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isDisabled}
                className={cn(
                  'flex h-full items-center justify-center rounded-r-full border-l border-border bg-muted px-2.5 transition-colors hover:bg-accent disabled:opacity-50',
                  isDisabled
                    ? 'text-muted-foreground'
                    : sendMode === 'goal'
                      ? 'text-amber-600 dark:text-amber-500'
                      : 'text-primary',
                )}
                aria-label={isStreaming ? 'Queue message' : sendMode === 'goal' ? 'Set goal' : 'Send message'}
                title={isStreaming ? 'Queue message' : undefined}
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
});
