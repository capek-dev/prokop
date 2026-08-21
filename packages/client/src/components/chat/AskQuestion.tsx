import React, { useState, useCallback } from 'react';
import { HelpCircle, Shield, Monitor } from 'lucide-react';
import type { HumanQuestion, FormQuestion, PermissionAsk, ClientCapabilityAsk, AskFormResponse, AskPermissionResponse, AskResponse } from '@prokopai/sdk';
import type { SingleSelectQuestion, MultiSelectQuestion, TextQuestion, ConfirmQuestion } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type { PendingAskRequest } from '@/stores/askStore';

interface AskQuestionProps {
  request: PendingAskRequest;
  onRespond: (toolCallId: string, response: AskResponse, requestId?: string) => void;
}



// --- SingleSelectView ---
function SingleSelectView({
  question,
  onSelect,
}: {
  question: SingleSelectQuestion;
  onSelect: (value: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {question.description && (
        <p className="text-sm text-muted-foreground">{question.description}</p>
      )}
      <div className="flex flex-col gap-2">
        {question.options.map((option, index) => (
          <button
            key={index}
            type="button"
            onClick={() => setSelectedIndex(index)}
            className={`flex flex-col items-start gap-1 p-3 rounded-lg border transition-colors text-left ${
              selectedIndex === index
                ? 'border-primary bg-primary/10 ring-1 ring-primary/30'
                : 'border-border hover:border-primary/50 hover:bg-muted/50'
            }`}
          >
            <div className="flex items-center gap-2 w-full">
              <div
                className={`size-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                  selectedIndex === index
                    ? 'border-primary bg-primary'
                    : 'border-muted-foreground'
                }`}
              >
                {selectedIndex === index && (
                  <div className="size-2 rounded-full bg-primary-foreground" />
                )}
              </div>
              <span className="font-medium">{option.label}</span>
            </div>
            {option.description && (
              <span className="text-xs text-muted-foreground pl-6">{option.description}</span>
            )}
          </button>
        ))}
      </div>
      {selectedIndex !== null && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => onSelect(question.options[selectedIndex].value)}>
            Confirm
          </Button>
        </div>
      )}
    </div>
  );
}

// --- MultiSelectView ---
function MultiSelectView({
  question,
  onSelect,
}: {
  question: MultiSelectQuestion;
  onSelect: (values: string[]) => void;
}) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  const toggleOption = useCallback((index: number) => {
    setSelectedIndices((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        if (question.max && newSet.size >= question.max) {
          return prev;
        }
        newSet.add(index);
      }
      return newSet;
    });
  }, [question.max]);

  const handleConfirm = useCallback(() => {
    const values = Array.from(selectedIndices).map((i) => question.options[i].value);
    if (question.min && values.length < question.min) {
      return;
    }
    onSelect(values);
  }, [selectedIndices, question.min, question.options, onSelect]);

  const isValid = !question.min || selectedIndices.size >= question.min;
  const maxReached = question.max ? selectedIndices.size >= question.max : false;

  return (
    <div className="flex flex-col gap-3">
      {question.description && (
        <p className="text-sm text-muted-foreground">{question.description}</p>
      )}
      <div className="flex flex-col gap-2">
        {question.options.map((option, index) => {
          const isDisabled = maxReached && !selectedIndices.has(index);
          return (
            <button
              key={index}
              type="button"
              onClick={() => toggleOption(index)}
              disabled={isDisabled}
              className={`flex flex-col items-start gap-1 p-3 rounded-lg border transition-colors text-left ${
                isDisabled
                  ? 'border-border opacity-50 cursor-not-allowed'
                  : selectedIndices.has(index)
                    ? 'border-primary bg-primary/5 hover:bg-primary/10'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center gap-2 w-full">
                <Checkbox
                  checked={selectedIndices.has(index)}
                  disabled={isDisabled}
                  onCheckedChange={() => toggleOption(index)}
                  className="pointer-events-none"
                />
                <span className="font-medium pointer-events-none">{option.label}</span>
              </div>
              {option.description && (
                <span className="text-xs text-muted-foreground pl-6">{option.description}</span>
              )}
            </button>
          );
        })}
      </div>
      {question.min !== undefined && (
        <p className="text-xs text-muted-foreground">
          Select at least {question.min} option{question.min > 1 ? 's' : ''}
          {question.max !== undefined && ` (up to ${question.max})`}
        </p>
      )}
      {question.max !== undefined && !question.min && (
        <p className="text-xs text-muted-foreground">
          Select up to {question.max} option{question.max > 1 ? 's' : ''}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleConfirm}
          disabled={!isValid}
        >
          Confirm Selection ({selectedIndices.size})
        </Button>
      </div>
    </div>
  );
}

// --- TextView (unchanged) ---
function TextView({
  question,
  onSubmit,
}: {
  question: TextQuestion;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState(question.defaultValue || '');

  return (
    <div className="flex flex-col gap-3">
      {question.description && (
        <p className="text-sm text-muted-foreground">{question.description}</p>
      )}
      <div className="flex flex-col gap-2">
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={question.placeholder}
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSubmit(value)}
          >
            Skip
          </Button>
          <Button
            size="sm"
            onClick={() => onSubmit(value)}
            disabled={value.trim().length === 0}
          >
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- ConfirmView ---
function ConfirmView({
  question,
  onConfirm,
}: {
  question: ConfirmQuestion;
  onConfirm: (value: boolean) => void;
}) {
  const defaultValue = question.defaultValue ?? false;
  const [selected, setSelected] = useState<boolean | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {question.description && (
        <p className="text-sm text-muted-foreground">{question.description}</p>
      )}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button
            variant={selected === false ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelected(false)}
          >
            {defaultValue ? 'No' : 'Cancel'}
          </Button>
          <Button
            variant={selected === true ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelected(true)}
          >
            {defaultValue ? 'Yes' : 'Confirm'}
          </Button>
        </div>
        {selected !== null && (
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => onConfirm(selected)}
            >
              Submit
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- FormView (NEW - renders multiple sub-questions as a single form) ---
function FormView({
  question,
  onSubmit,
}: {
  question: FormQuestion;
  onSubmit: (response: AskFormResponse) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string | boolean | string[]>>({});

  const allAnswered = question.questions.every((_, i) => answers[i] !== undefined);

  const handleSubmit = useCallback(() => {
    const response: AskFormResponse = {
      type: 'form',
      answers: question.questions.map((q, i) => ({
        question: q.question,
        answer: answers[i],
      })),
    };
    onSubmit(response);
  }, [question.questions, answers, onSubmit]);

  return (
    <div className="flex flex-col gap-4">
      {question.description && (
        <p className="text-sm text-muted-foreground">{question.description}</p>
      )}
      <div className="flex flex-col gap-4">
        {question.questions.map((subQuestion, index) => (
          <div key={index} className="border-l-2 border-primary/30 pl-3">
            <p className="text-xs text-muted-foreground mb-2">Question {index + 1} of {question.questions.length}</p>
            <SubQuestionView
              question={subQuestion}
              onAnswer={(answer) => setAnswers((prev) => ({ ...prev, [index]: answer }))}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!allAnswered}
        >
          Submit All ({Object.keys(answers).length}/{question.questions.length})
        </Button>
      </div>
    </div>
  );
}

// Helper to render sub-questions inline (without borders)
function SubQuestionView({
  question,
  onAnswer,
}: {
  question: HumanQuestion;
  onAnswer: (answer: string | boolean | string[]) => void;
}) {
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [confirmValue, setConfirmValue] = useState<boolean | null>(null);

  switch (question.type) {
    case 'single_select':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{question.question}</p>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  setSelectedIndices(new Set([index]));
                  onAnswer(option.value);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  selectedIndices.has(index)
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <span
                  className={`size-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    selectedIndices.has(index) ? 'border-primary' : 'border-muted-foreground/50'
                  }`}
                >
                  {selectedIndices.has(index) && (
                    <span className="size-1.5 rounded-full bg-primary" />
                  )}
                </span>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    case 'multi_select': {
      const toggle = (index: number) => {
        const next = new Set(selectedIndices);
        if (next.has(index)) {
          next.delete(index);
        } else if (!question.max || next.size < question.max) {
          next.add(index);
        } else {
          return;
        }
        setSelectedIndices(next);
        onAnswer(Array.from(next).map((i) => question.options[i].value));
      };
      const msMaxReached = question.max ? selectedIndices.size >= question.max : false;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{question.question}</p>
            <span className="text-xs text-muted-foreground">
              {selectedIndices.size > 0 ? `${selectedIndices.size} selected` : 'Select all that apply'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {question.options.map((option, index) => {
              const isDisabled = msMaxReached && !selectedIndices.has(index);
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => toggle(index)}
                  disabled={isDisabled}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    isDisabled
                      ? 'border-border opacity-50 cursor-not-allowed'
                      : selectedIndices.has(index)
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                  }`}
                >
                  <span
                    className={`size-3.5 rounded-[3px] border-2 flex items-center justify-center shrink-0 transition-colors ${
                      selectedIndices.has(index) ? 'border-primary bg-primary' : 'border-muted-foreground/50'
                    }`}
                  >
                    {selectedIndices.has(index) && (
                      <svg className="size-2.5 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case 'text':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{question.question}</p>
          <Input
            type="text"
            placeholder={question.placeholder}
            defaultValue={question.defaultValue}
            onChange={(e) => onAnswer(e.target.value)}
          />
        </div>
      );
    case 'confirm':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{question.question}</p>
          <div className="flex gap-2">
            <Button
              variant={confirmValue === false ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setConfirmValue(false);
                onAnswer(false);
              }}
            >
              No
            </Button>
            <Button
              variant={confirmValue === true ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setConfirmValue(true);
                onAnswer(true);
              }}
            >
              Yes
            </Button>
          </div>
        </div>
      );
  }
}

// --- PermissionAskView ---
function PermissionAskView({
  ask,
  onRespond,
}: {
  ask: PermissionAsk;
  onRespond: (response: AskPermissionResponse) => void;
}) {
  const riskColors: Record<string, string> = {
    none: 'text-muted-foreground',
    low: 'text-success',
    medium: 'text-warning',
    high: 'text-destructive',
    critical: 'text-destructive',
  };

  // Extract intent info for better UX
  const primaryIntent = ask.intents?.[0];
  const effectiveAction = ask.action ?? primaryIntent?.action;
  const effectiveResource = ask.resource ?? primaryIntent?.resource ?? 'shell-command';

  // Determine operation label from action
  const operationLabel = effectiveAction === 'read'
    ? 'Reading'
    : effectiveAction === 'write'
      ? 'Writing to'
      : effectiveAction === 'delete'
        ? 'Deleting'
        : effectiveAction === 'request'
          ? 'Requesting'
          : effectiveAction === 'execute'
            ? 'Executing'
            : null;

  // Determine allowed scopes — use server-provided list or fallback
  const allowedScopes = ask.allowedScopes ?? ['once', 'session', 'workspace'];
  const nonPersistableReason = primaryIntent?.persistable === false
    ? primaryIntent.nonPersistableReason
    : undefined;

  // Build scope button labels based on intent
  const scopeLabels: Record<string, string> = {};
  if (effectiveResource === 'file' && effectiveAction === 'read') {
    scopeLabels['session'] = 'Allow for This Session';
    scopeLabels['workspace'] = 'Always Allow Reading This File';
  } else if (effectiveResource === 'file' && effectiveAction === 'write') {
    scopeLabels['session'] = 'Allow for This Session';
    scopeLabels['workspace'] = 'Always Allow Writing This File';
  } else if (effectiveResource === 'file' && effectiveAction === 'delete') {
    scopeLabels['session'] = 'Allow for This Session';
  } else if (effectiveResource === 'network') {
    scopeLabels['session'] = 'Allow for This Session';
    scopeLabels['workspace'] = 'Always Allow This Network Request';
  } else if (effectiveResource === 'shell-command') {
    scopeLabels['session'] = 'Allow for This Session';
  }

  const getScopeLabel = (scope: string): string => {
    if (scopeLabels[scope]) return scopeLabels[scope];
    switch (scope) {
      case 'once': return 'Allow Once';
      case 'session': return 'Allow for This Session';
      case 'workspace': return 'Allow for Workspace';
      case 'always': return 'Allow for Workspace';
      default: return `Allow (${scope})`;
    }
  };

  // Build target display from intent targets
  const intentTargets = primaryIntent?.targets ?? [];
  const displayTargets = intentTargets.length > 0
    ? intentTargets.map(t => t.target.split('/').pop() || t.target)
    : [];

  // Helper to render shell command
  const renderShellCommand = (): React.ReactElement | null => {
    if (effectiveResource !== 'shell-command' || typeof ask.metadata?.command !== 'string') {
      return null;
    }
    return (
      <div>
        <div className="text-xs uppercase text-muted-foreground mb-1">Command</div>
        <pre className="text-xs bg-muted/50 border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">
          {ask.metadata.command}
        </pre>
      </div>
    );
  };

  // Helper to render file paths
  const renderFilePaths = (): React.ReactElement | null => {
    const paths = ask.paths as string[] | undefined;
    const isFileResource =
      effectiveResource === 'file' || effectiveResource === 'path' || effectiveResource === 'directory';
    if (!paths || paths.length === 0 || !isFileResource) {
      return null;
    }
    return (
      <div>
        <div className="text-xs uppercase text-muted-foreground mb-1">{operationLabel ?? 'Accessing'}</div>
        <pre className="text-xs bg-muted/50 border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">
          {paths.join('\n')}
        </pre>
      </div>
    );
  };

  // Helper to render network URL
  const renderNetworkUrl = (): React.ReactElement | null => {
    if (effectiveResource !== 'network' || typeof ask.metadata?.url !== 'string') {
      return null;
    }
    return (
      <div>
        <div className="text-xs uppercase text-muted-foreground mb-1">URL</div>
        <pre className="text-xs bg-muted/50 border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">
          {ask.metadata.url}
        </pre>
      </div>
    );
  };

  // Helper to render intent targets
  const renderIntentTargets = (): React.ReactElement | null => {
    if (displayTargets.length === 0 || effectiveResource === 'shell-command') return null;
    return (
      <div className="flex flex-wrap gap-1">
        {displayTargets.map((target, i) => (
          <code key={i} className="text-xs bg-muted/50 border rounded px-1.5 py-0.5 font-mono">
            {target}
          </code>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {ask.description && (
        <p className="text-sm text-muted-foreground">{ask.description}</p>
      )}
      {ask.risk && (
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium uppercase ${riskColors[ask.risk ?? 'none'] ?? 'text-muted-foreground'}`}>
            Risk: {ask.risk}
          </span>
        </div>
      )}
      {renderShellCommand()}
      {renderFilePaths()}
      {renderNetworkUrl()}
      {renderIntentTargets()}
      {ask.metadata?.description && typeof ask.metadata.description === 'string' && !ask.description ? (
        <p className="text-xs text-muted-foreground">{ask.metadata.description as string}</p>
      ) : null}
      {nonPersistableReason && (
        <p className="text-xs text-muted-foreground italic">
          This command is too dynamic to save as a reusable permission ({nonPersistableReason}).
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onRespond({ type: 'permission', grant: 'deny' })}
        >
          Block
        </Button>
        {allowedScopes.map((scope) => (
          <Button
            key={scope}
            variant={scope === 'workspace' ? 'default' : 'outline'}
            size="sm"
            onClick={() => onRespond({ type: 'permission', grant: scope })}
          >
            {getScopeLabel(scope)}
          </Button>
        ))}
      </div>
    </div>
  );
}

// --- ClientCapabilityAskView (NEW - shows capability request status) ---
function ClientCapabilityAskView({
  ask,
  onRespond,
}: {
  ask: ClientCapabilityAsk;
  onRespond: (response: unknown) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Client capability request: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{ask.capability}</code>
      </p>
      {ask.metadata && (
        <pre className="text-xs bg-background border rounded-md p-2 overflow-x-auto">
          {JSON.stringify(ask.metadata, null, 2)}
        </pre>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => onRespond(undefined)}>
          Not Available
        </Button>
        <Button size="sm" onClick={() => onRespond(null)}>
          Confirm
        </Button>
      </div>
    </div>
  );
}

// --- Main component ---
export function AskQuestion({ request, onRespond }: AskQuestionProps) {
  const { toolCallId, toolName, ask, requestId } = request;

  // Handlers for each ask type - properly typed to match AskResponse variants
  const handleSingleSelect = useCallback(
    (value: string) => {
      onRespond(toolCallId, { type: 'single_select', value }, requestId);
    },
    [toolCallId, onRespond, requestId],
  );

  const handleMultiSelect = useCallback(
    (values: string[]) => {
      onRespond(toolCallId, { type: 'multi_select', values }, requestId);
    },
    [toolCallId, onRespond, requestId],
  );

  const handleText = useCallback(
    (value: string) => {
      onRespond(toolCallId, { type: 'text', value }, requestId);
    },
    [toolCallId, onRespond, requestId],
  );

  const handleConfirm = useCallback(
    (confirmed: boolean) => {
      onRespond(toolCallId, { type: 'confirm', confirmed }, requestId);
    },
    [toolCallId, onRespond, requestId],
  );

  const handleForm = useCallback(
    (response: AskFormResponse) => {
      onRespond(toolCallId, response, requestId);
    },
    [toolCallId, onRespond, requestId],
  );

  const handlePermission = useCallback(
    (response: AskPermissionResponse) => {
      onRespond(toolCallId, response, requestId);
    },
    [toolCallId, onRespond, requestId],
  );

  const handleClientCapability = useCallback(
    (result: unknown) => {
      const capability = ask.type === 'client_capability' ? ask.capability : '';
      onRespond(toolCallId, { type: 'client_capability', capability, result }, requestId);
    },
    [toolCallId, onRespond, ask, requestId],
  );

  // Determine icon and border color by type discriminator
  const config = (() => {
    if ('type' in ask) {
      switch (ask.type) {
        case 'single_select':
        case 'multi_select':
        case 'text':
        case 'confirm':
        case 'form':
          return { icon: HelpCircle, borderClass: 'border-primary/30 bg-primary/5', iconClass: 'text-primary' };
        case 'permission':
          return { icon: Shield, borderClass: 'border-warning/30 bg-warning/5', iconClass: 'text-warning' };
        case 'client_capability':
          return { icon: Monitor, borderClass: 'border-info/30 bg-info/5', iconClass: 'text-info' };
      }
    }
    return { icon: Shield, borderClass: 'border-warning/30 bg-warning/5', iconClass: 'text-warning' };
  })();
  const Icon = config.icon;

  return (
    <div className={`border ${config.borderClass} rounded-lg p-4 flex flex-col gap-4`}>
      <div className={`flex items-start gap-2 ${config.iconClass}`}>
        <Icon className="size-4 mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">
            {toolName}
          </span>
          {'question' in ask && <p className="text-sm font-medium">{ask.question}</p>}
        </div>
      </div>

      {ask.type === 'single_select' && (
        <SingleSelectView question={ask} onSelect={handleSingleSelect} />
      )}
      {ask.type === 'multi_select' && (
        <MultiSelectView question={ask} onSelect={handleMultiSelect} />
      )}
      {ask.type === 'text' && (
        <TextView question={ask} onSubmit={handleText} />
      )}
      {ask.type === 'confirm' && (
        <ConfirmView question={ask} onConfirm={handleConfirm} />
      )}
      {ask.type === 'form' && (
        <FormView question={ask} onSubmit={handleForm} />
      )}
      {(ask.type === 'permission' || !('type' in ask)) && (
        <PermissionAskView ask={ask} onRespond={handlePermission} />
      )}
      {ask.type === 'client_capability' && (
        <ClientCapabilityAskView ask={ask} onRespond={handleClientCapability} />
      )}
    </div>
  );
}
