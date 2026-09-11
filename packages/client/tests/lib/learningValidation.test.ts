import { expect, test } from 'vitest';
import type { WorkspaceLearningSettings } from '@prokopai/sdk';
import { learningValidationError } from '@/lib/learningValidation';

test('learning drafts reject missing reviewers and inconsistent timing without blocking disabled settings', () => {
  const settings: WorkspaceLearningSettings = { enabled: true, reviewers: [], improveSkills: false, instructions: '', sources: { mode: 'all' } };
  expect(learningValidationError(settings, ['dev'])).toContain('learner');
  settings.reviewers.push({ id: 'r', preconfigId: 'dev', instructions: '', modelOverride: null, cadence: null });
  expect(learningValidationError(settings, [])).toContain('available preconfig');
  expect(learningValidationError(settings, ['dev'])).toBeNull();
  settings.reviewers[0].cadence = { idleMinutes: 1, minimumIntervalMinutes: 10, maximumPendingMinutes: 5 };
  expect(learningValidationError(settings, ['dev'])).toContain('Maximum pending');
  settings.enabled = false;
  expect(learningValidationError(settings, [])).toBeNull();
});
