import { useState, useEffect, useCallback } from 'react';
import type { ProkopaiClient, ScheduledJob, ScheduleKind, ScheduleConfig, AutoApproveSeverity } from '@prokopai/sdk';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useServerDataStore } from '@/stores/serverDataStore';
import {
  useCreateScheduledJob,
  useUpdateScheduledJob,
} from '@/hooks/queries';
import { formatLastRun } from '@/utils/scheduleCountdown';
import { Loader2 } from 'lucide-react';

interface SchedulerJobModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sdkClient: ProkopaiClient | null;
  workspaceId: string | null;
  editingJob: ScheduledJob | null;
}

const DAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

export function SchedulerJobModal({
  open,
  onOpenChange,
  sdkClient,
  workspaceId,
  editingJob,
}: SchedulerJobModalProps) {
  const preconfigs = useServerDataStore((s) => s.preconfigs);

  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('interval');
  const [intervalMinutes, setIntervalMinutes] = useState(120);
  const [dailyTime, setDailyTime] = useState('09:00');
  const [weeklyDays, setWeeklyDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [weeklyTime, setWeeklyTime] = useState('09:00');
  const [onceDate, setOnceDate] = useState('');
  const [onceTime, setOnceTime] = useState('');
  const [repeatLimit, setRepeatLimit] = useState<string>('');
  const [preconfigId, setPreconfigId] = useState<string>('__default__');
  const [reuseSession, setReuseSession] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [autoApproveSeverity, setAutoApproveSeverity] = useState<AutoApproveSeverity | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useCreateScheduledJob(sdkClient, workspaceId);
  const updateMutation = useUpdateScheduledJob(sdkClient, workspaceId);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingJob) {
      setName(editingJob.name);
      setPrompt(editingJob.prompt);
      setScheduleKind(editingJob.scheduleKind);
      const config = editingJob.scheduleConfig;
      if (config.type === 'interval') setIntervalMinutes(config.intervalMinutes);
      if (config.type === 'daily') setDailyTime(config.time);
      if (config.type === 'weekly') {
        setWeeklyDays(config.days);
        setWeeklyTime(config.time);
      }
      if (config.type === 'once') {
        const d = new Date(config.runAt);
        setOnceDate(d.toISOString().slice(0, 10));
        setOnceTime(d.toTimeString().slice(0, 5));
      }
      setRepeatLimit(editingJob.repeatLimit !== null ? String(editingJob.repeatLimit) : '');
      setPreconfigId(editingJob.preconfigId ?? '__default__');
      setReuseSession(editingJob.reuseSession);
      setIncludeHistory(editingJob.includeHistory);
      setAutoApproveSeverity(editingJob.autoApproveSeverity);
      setNotificationsEnabled(editingJob.notificationsEnabled === true);
    } else {
      setName('');
      setPrompt('');
      setScheduleKind('interval');
      setIntervalMinutes(120);
      setDailyTime('09:00');
      setWeeklyDays([1, 2, 3, 4, 5]);
      setWeeklyTime('09:00');
      setOnceDate('');
      setOnceTime('');
      setRepeatLimit('');
      setPreconfigId('__default__');
      setReuseSession(false);
      setIncludeHistory(false);
      setAutoApproveSeverity(null);
      setNotificationsEnabled(false);
    }
  }, [open, editingJob]);

  const buildScheduleConfig = useCallback((): ScheduleConfig => {
    switch (scheduleKind) {
      case 'interval':
        return { type: 'interval', intervalMinutes };
      case 'daily':
        return { type: 'daily', time: dailyTime };
      case 'weekly':
        return { type: 'weekly', days: weeklyDays, time: weeklyTime };
      case 'once': {
        const dateStr = onceDate || new Date().toISOString().slice(0, 10);
        const timeStr = onceTime || '12:00';
        return { type: 'once', runAt: new Date(`${dateStr}T${timeStr}`).toISOString() };
      }
    }
  }, [scheduleKind, intervalMinutes, dailyTime, weeklyDays, weeklyTime, onceDate, onceTime]);

  const handleSave = useCallback(async () => {
    if (!workspaceId || !name.trim() || !prompt.trim()) return;

    const config = buildScheduleConfig();
    const limitValue = repeatLimit.trim() === '' ? null : parseInt(repeatLimit, 10);
    const preconfigValue = preconfigId === '__default__' ? null : preconfigId;

    setError(null);
    try {
      if (editingJob) {
        await updateMutation.mutateAsync({
          jobId: editingJob.id,
          updates: {
            name: name.trim(),
            prompt: prompt.trim(),
            scheduleKind,
            scheduleConfig: config,
            repeatLimit: limitValue,
            preconfigId: preconfigValue,
            reuseSession,
            includeHistory,
            autoApproveSeverity,
            notificationsEnabled,
          },
        });
      } else {
        await createMutation.mutateAsync({
          name: name.trim(),
          prompt: prompt.trim(),
          scheduleKind,
          scheduleConfig: config,
          repeatLimit: limitValue,
          preconfigId: preconfigValue,
          reuseSession,
          includeHistory,
          autoApproveSeverity,
          notificationsEnabled,
        });
      }
      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save scheduled job');
    }
  }, [workspaceId, name, prompt, buildScheduleConfig, repeatLimit, preconfigId, editingJob, scheduleKind, createMutation, updateMutation, onOpenChange, autoApproveSeverity, notificationsEnabled, reuseSession, includeHistory]);

  const toggleDay = (day: number) => {
    setWeeklyDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort(),
    );
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isSaving) onOpenChange(nextOpen); }}>
      <DialogContent className="flex flex-col overflow-hidden p-3 sm:p-4 gap-3 sm:gap-4 max-w-[calc(100vw-0.5rem)] sm:max-w-[560px] h-[85dvh] sm:h-[85vh]">
        <DialogHeader className="shrink-0">
          <DialogTitle>{editingJob ? 'Edit Scheduled Job' : 'New Scheduled Job'}</DialogTitle>
          <DialogDescription>
            Schedule a task to run automatically. Each run creates a new session.
          </DialogDescription>
        </DialogHeader>

        <div className="dialog-scrollbar flex-1 min-h-0 overflow-y-auto overscroll-contain rounded-lg border p-3 sm:p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="job-name">Name</Label>
            <Input
              id="job-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily summary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="job-prompt">Prompt</Label>
            <Textarea
              id="job-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Check the build status and summarize any failures"
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>Schedule</Label>
            <Tabs value={scheduleKind} onValueChange={(v) => setScheduleKind(v as ScheduleKind)}>
              <TabsList className="w-full">
                <TabsTrigger value="interval" className="flex-1">Interval</TabsTrigger>
                <TabsTrigger value="daily" className="flex-1">Daily</TabsTrigger>
                <TabsTrigger value="weekly" className="flex-1">Weekly</TabsTrigger>
                <TabsTrigger value="once" className="flex-1">Once</TabsTrigger>
              </TabsList>

              <TabsContent value="interval" className="pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Run every</span>
                  <Input
                    type="number"
                    min={1}
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">minutes</span>
                </div>
              </TabsContent>

              <TabsContent value="daily" className="pt-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Run at</span>
                  <Input
                    type="time"
                    value={dailyTime}
                    onChange={(e) => setDailyTime(e.target.value)}
                    className="w-32"
                  />
                </div>
              </TabsContent>

              <TabsContent value="weekly" className="pt-3 space-y-3">
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">Run on</div>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map(day => (
                      <label key={day.value} className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={weeklyDays.includes(day.value)}
                          onCheckedChange={() => toggleDay(day.value)}
                        />
                        <span className="text-sm">{day.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">at</span>
                  <Input
                    type="time"
                    value={weeklyTime}
                    onChange={(e) => setWeeklyTime(e.target.value)}
                    className="w-32"
                  />
                </div>
              </TabsContent>

              <TabsContent value="once" className="pt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Date</span>
                  <Input
                    type="date"
                    value={onceDate}
                    onChange={(e) => setOnceDate(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Time</span>
                  <Input
                    type="time"
                    value={onceTime}
                    onChange={(e) => setOnceTime(e.target.value)}
                    className="w-32"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="job-repeat">Repeat limit (optional)</Label>
              <Input
                id="job-repeat"
                type="number"
                min={1}
                value={repeatLimit}
                onChange={(e) => setRepeatLimit(e.target.value)}
                placeholder="Infinite"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-preconfig">Agent</Label>
              <Select value={preconfigId} onValueChange={setPreconfigId}>
                <SelectTrigger>
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Default</SelectItem>
                  {preconfigs.map(pc => (
                    <SelectItem key={pc.id} value={pc.id}>{pc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Checkbox
              id="job-reuse-session"
              checked={reuseSession}
              onCheckedChange={(checked) => setReuseSession(checked === true)}
            />
            <Label htmlFor="job-reuse-session" className="text-sm font-normal cursor-pointer">
              Reuse same session for each run
            </Label>
          </div>

          {reuseSession && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="job-include-history"
                checked={includeHistory}
                onCheckedChange={(checked) => setIncludeHistory(checked === true)}
              />
              <Label htmlFor="job-include-history" className="text-sm font-normal cursor-pointer">
                Include previous run history (agent sees past context)
              </Label>
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="job-notifications">Send notifications</Label>
              <p className="text-xs text-muted-foreground">
                Allow this job to send completion, failure, and permission request notifications.
                Each device's notification preferences still apply.
              </p>
            </div>
            <Switch
              id="job-notifications"
              checked={notificationsEnabled}
              onCheckedChange={setNotificationsEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label>Auto-approve permissions</Label>
            <p className="text-xs text-muted-foreground">
              Controls what permissions are auto-approved for sessions created by this job. "Use workspace default" inherits from workspace settings.
            </p>
            <Select
              value={autoApproveSeverity ?? '__workspace__'}
              onValueChange={(v) => setAutoApproveSeverity(v === '__workspace__' ? null : v as AutoApproveSeverity)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__workspace__">Use workspace default</SelectItem>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {editingJob && (
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Runs</span>
                <span>{editingJob.runCount}{editingJob.repeatLimit !== null ? ` / ${editingJob.repeatLimit}` : ''}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last run</span>
                <span>{formatLastRun(editingJob)}</span>
              </div>
              {editingJob.lastError && (
                <div className="text-destructive pt-1">
                  <span className="text-muted-foreground">Error: </span>
                  {editingJob.lastError}
                </div>
              )}
            </div>
          )}
        </div>

        {error && (
          <div role="alert" className="shrink-0 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || !prompt.trim() || isSaving}>
            {isSaving && <Loader2 data-icon="inline-start" className="animate-spin" />}
            {isSaving ? 'Saving...' : editingJob ? 'Save changes' : 'Create job'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
