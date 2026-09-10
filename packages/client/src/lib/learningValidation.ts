import type { WorkspaceLearningSettings } from '@prokopai/sdk';

export function learningValidationError(settings: WorkspaceLearningSettings | undefined, preconfigIds: string[]): string | null {
  if (!settings?.enabled) return null;
  if (!settings.reviewers.length) return 'Add a reviewer before enabling learning.';
  for (const reviewer of settings.reviewers) {
    if (!preconfigIds.includes(reviewer.preconfigId)) return 'Select an available preconfig for every reviewer.';
    const cadence = reviewer.cadence;
    if (cadence && cadence.maximumPendingMinutes < cadence.minimumIntervalMinutes) return 'Maximum pending age must be at least the minimum interval.';
  }
  return null;
}
