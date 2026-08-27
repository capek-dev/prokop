import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SettingsSection {
  value: string;
  label: string;
  icon: LucideIcon;
  group: string;
}

export interface SettingsGroup {
  key: string;
  label: string;
}

interface SettingsDialogShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  sections: SettingsSection[];
  groups: SettingsGroup[];
  value: string;
  onValueChange: (value: string) => void;
  renderPanel: (value: string) => ReactNode;
  footer?: ReactNode;
}

export function PanelLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-32 text-muted-foreground">
      <div className="h-5 w-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
    </div>
  );
}

/**
 * Shared scaffolding for the settings dialogs: mobile section dropdown,
 * desktop icon tab rail grouped by section group, and a single scrolling
 * content area that only mounts the selected panel.
 */
export function SettingsDialogShell({
  open,
  onOpenChange,
  title,
  description,
  sections,
  groups,
  value,
  onValueChange,
  renderPanel,
  footer,
}: SettingsDialogShellProps) {
  const sectionsFor = (group: string) => sections.filter((s) => s.group === group);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden p-3 sm:p-4 gap-3 sm:gap-4 max-w-[calc(100vw-0.5rem)] sm:max-w-[860px] h-[85dvh] sm:h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Mobile: Select dropdown */}
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger className="sm:hidden w-full shrink-0" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groups.map((group) => (
              <SectionSelectItems key={group.key} group={group} sections={sectionsFor(group.key)} />
            ))}
          </SelectContent>
        </Select>

        <Tabs
          value={value}
          onValueChange={onValueChange}
          orientation="vertical"
          className="mt-2 flex-1 min-h-0"
        >
          {/* Desktop sidebar */}
          <TabsList className="hidden sm:flex flex-col h-fit w-44 lg:w-48 shrink-0 items-stretch gap-0.5 bg-transparent p-1 rounded-lg">
            {groups.map((group, groupIndex) => (
              <div key={group.key} className="contents">
                <span className={groupIndex === 0 ? 'px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground' : 'px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'}>
                  {group.label}
                </span>
                {sectionsFor(group.key).map((s) => (
                  <TabsTrigger
                    key={s.value}
                    value={s.value}
                    className="justify-start px-3 py-1.5 text-sm"
                  >
                    <s.icon className="size-4" data-icon="inline-start" />
                    <span>{s.label}</span>
                  </TabsTrigger>
                ))}
              </div>
            ))}
          </TabsList>

          {/* Shared content area - only mount the selected panel */}
          <div className="dialog-scrollbar flex-1 min-w-0 min-h-0 overflow-y-auto overscroll-contain rounded-lg border">
            <TabsContent key={value} value={value} className="mt-0">
              {renderPanel(value)}
            </TabsContent>
          </div>
        </Tabs>

        {footer}
      </DialogContent>
    </Dialog>
  );
}

function SectionSelectItems({ group, sections }: { group: SettingsGroup; sections: SettingsSection[] }) {
  return (
    <>
      <SelectItem value={`_${group.key}_group`} disabled className="text-xs font-semibold text-muted-foreground">
        {group.label}
      </SelectItem>
      {sections.map((s) => (
        <SelectItem key={s.value} value={s.value}>
          <s.icon className="size-4" />
          {s.label}
        </SelectItem>
      ))}
    </>
  );
}
