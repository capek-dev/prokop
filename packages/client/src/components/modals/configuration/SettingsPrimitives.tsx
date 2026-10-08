import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Shared building blocks for settings panels, so lists, editors, errors,
 * and empty or loading states look the same in every section.
 */

export function SettingsError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function SettingsEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function SettingsLoading() {
  return (
    <div className="flex items-center justify-center p-8" role="status" aria-label="Loading">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

interface SettingsListRowProps {
  title: string;
  onOpen: () => void;
  /** Badges shown right after the title. */
  badges?: ReactNode;
  /** One muted line after the title, truncated so every row keeps one height. */
  description?: string | null;
  /** Right-aligned recap such as a count or status. */
  meta?: ReactNode;
  /** Icon buttons; hidden until hover on pointer devices, always shown on touch. */
  actions?: ReactNode;
}

export function SettingsListRow({ title, onOpen, badges, description, meta, actions }: SettingsListRowProps) {
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-lg border pr-2 transition-colors hover:bg-muted/50">
      <button
        type="button"
        onClick={onOpen}
        title={description || title}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left outline-none focus-visible:underline"
      >
        <span className="shrink-0 truncate text-sm font-medium">{title}</span>
        {badges}
        {description && <span className="min-w-0 truncate text-xs text-muted-foreground">{description}</span>}
        {meta && <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{meta}</span>}
      </button>
      {actions && (
        <div className={cn(
          'flex shrink-0 items-center gap-0.5 transition-opacity',
          'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100',
        )}>
          {actions}
        </div>
      )}
    </div>
  );
}

interface SettingsEditorHeaderProps {
  title: string;
  onBack: () => void;
  backLabel: string;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}

export function SettingsEditorHeader({ title, onBack, backLabel, onSave, saving, canSave }: SettingsEditorHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label={backLabel}>
          <ArrowLeft className="size-4" />
        </Button>
        <h3 className="truncate text-sm font-medium">{title}</h3>
      </div>
      <Button size="sm" onClick={onSave} disabled={saving || !canSave}>
        {saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
      </Button>
    </div>
  );
}
