import { useCallback } from 'react';
import {
  Clock,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Pause,
  Play,
  Zap,
  Pencil,
  Trash2,
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Loader2,
  Bell,
} from 'lucide-react';
import type { ScheduledJob, Session } from '@prokopai/sdk';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import {
  Badge,
} from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useNow } from '@/hooks/useNow';

interface ScheduledJobsSectionProps {
  jobs: ScheduledJob[];
  sessionsByJob: Map<string, Session[]>;
  pendingJobIds?: ReadonlySet<string>;
  currentSessionId: string | null;
  onCreateJob: () => void;
  onEditJob: (job: ScheduledJob) => void;
  onPauseJob: (jobId: string) => void;
  onResumeJob: (jobId: string) => void;
  onTriggerJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onOpenSession: (sessionId: string) => void;
}

function relativeTime(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function ScheduledJobsSection({
  jobs,
  sessionsByJob,
  pendingJobIds,
  currentSessionId,
  onCreateJob,
  onEditJob,
  onPauseJob,
  onResumeJob,
  onTriggerJob,
  onDeleteJob,
  onOpenSession,
}: ScheduledJobsSectionProps) {
  const now = useNow(30_000);

  const getNextRunLabel = useCallback(
    (job: ScheduledJob) => {
      if (job.state === 'paused') return 'Paused';
      if (job.state === 'completed') return 'Completed';
      if (!job.nextRunAt) return 'Pending';

      const ts = new Date(job.nextRunAt).getTime();
      const diff = ts - now;
      if (diff <= 0) return 'Overdue';

      const minutes = Math.floor(diff / 60_000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `in ${days}d ${hours % 24}h`;
      if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
      if (minutes > 0) return `in ${minutes}m`;
      return 'soon';
    },
    [now],
  );

  const getStateIcon = (state: string) => {
    if (state === 'paused') return <Pause className="size-3 text-muted-foreground" />;
    if (state === 'completed') return <CheckCircle2 className="size-3 text-muted-foreground" />;
    return null;
  };

  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup>
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between w-full">
              <span className="flex items-center gap-2">
                <ChevronRight className="size-3 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                Scheduled
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{jobs.length}</Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                      title="Scheduled jobs"
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCreateJob(); }}>
                      <Plus className="size-4" />
                      New scheduled job
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              {jobs.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No scheduled jobs.
                </div>
              )}
              {jobs.map((job) => {
                const runs = sessionsByJob.get(job.id) ?? [];
                const isMutating = pendingJobIds?.has(job.id) ?? false;
                return (
                  <Collapsible key={job.id} className="group/job-collapsible">
                    <SidebarMenuItem>
                      <div className="flex items-center w-full rounded-md hover:bg-sidebar-accent transition-colors">
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="flex items-center gap-2 min-w-0 flex-1 px-2 py-1.5 text-left cursor-pointer"
                            onClick={() => onEditJob(job)}
                          >
                            <Clock className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium truncate">{job.name}</span>
                                {getStateIcon(job.state)}
                                {job.notificationsEnabled && (
                                  <Bell
                                    className="size-3 shrink-0 text-muted-foreground"
                                    role="img"
                                    aria-label="Notifications enabled"
                                  />
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {job.scheduleDisplay} . {getNextRunLabel(job)}
                              </div>
                              {job.lastError && (
                                <div className="text-xs text-destructive truncate flex items-center gap-1 mt-0.5">
                                  <AlertCircle className="size-3 shrink-0" />
                                  <span className="truncate">{job.lastError}</span>
                                </div>
                              )}
                            </div>
                          </button>
                        </CollapsibleTrigger>
                        <div className="flex items-center gap-1 shrink-0 pr-1">
                          {runs.length > 0 && (
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="p-1 rounded-md hover:bg-sidebar-accent-foreground/10 transition-colors"
                                title={`${runs.length} run${runs.length === 1 ? '' : 's'}`}
                              >
                                <div className="flex items-center gap-0.5">
                                  <ChevronRight className="size-3 transition-transform duration-200 group-data-[state=open]/job-collapsible:rotate-90" />
                                  <Badge variant="secondary" className="text-[10px] px-1 py-0">{runs.length}</Badge>
                                </div>
                              </button>
                            </CollapsibleTrigger>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                disabled={isMutating}
                                className="p-1 rounded-md hover:bg-sidebar-accent-foreground/10 opacity-0 group-hover/job-collapsible:opacity-100 transition-opacity disabled:opacity-100"
                                title={isMutating ? 'Updating job' : 'Job actions'}
                              >
                                {isMutating ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="size-3.5" />
                                )}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-40">
                              <DropdownMenuItem onClick={() => onEditJob(job)}>
                                <Pencil className="size-4" />
                                Edit
                              </DropdownMenuItem>
                              {job.state === 'active' && (
                                <DropdownMenuItem disabled={isMutating} onClick={() => onPauseJob(job.id)}>
                                  <Pause className="size-4" />
                                  Pause
                                </DropdownMenuItem>
                              )}
                              {(job.state === 'paused' || job.state === 'completed') && (
                                <DropdownMenuItem disabled={isMutating} onClick={() => onResumeJob(job.id)}>
                                  <Play className="size-4" />
                                  Resume
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem disabled={isMutating} onClick={() => onTriggerJob(job.id)}>
                                <Zap className="size-4" />
                                Trigger now
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => onDeleteJob(job.id)}
                                disabled={isMutating}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="size-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </SidebarMenuItem>
                    <CollapsibleContent>
                      <div className="ml-4 border-l border-border pl-1 space-y-0.5 mb-1">
                        {runs.slice(0, 10).map((session) => (
                          <SidebarMenuButton
                            key={session.id}
                            isActive={currentSessionId === session.id}
                            onClick={() => onOpenSession(session.id)}
                            className="text-xs h-7"
                          >
                            <MessageSquare className="size-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{session.title?.replace(/^\[Scheduled\]\s*/, '') ?? 'Run'}</span>
                            <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                              {relativeTime(session.updatedAt, now)}
                            </span>
                          </SidebarMenuButton>
                        ))}
                        {runs.length > 10 && (
                          <div className="px-3 py-0.5 text-[10px] text-muted-foreground">
                            +{runs.length - 10} more
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
