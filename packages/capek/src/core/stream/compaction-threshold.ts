import {
  findModel,
  getCompactionAutoReserveCapTokens,
  getCompactionAutoSafetyMarginTokens,
  getCompactionAutoThresholdRatio,
  getMaxOutputTokens,
} from '../../configuration/runtime';
import type { CompactionPolicy } from '../compaction';

export interface AutoThresholdResult {
  threshold: number;
  contextWindow: number | undefined;
}

export function computeAutoThreshold(
  modelId: string | undefined,
  policy?: CompactionPolicy,
): AutoThresholdResult {
  const modelDef = modelId ? findModel(modelId) : undefined;
  const contextWindow = modelDef?.contextWindow;

  if (!contextWindow) {
    return { threshold: 0, contextWindow: undefined };
  }

  const modelMaxOutputTokens = getMaxOutputTokens(modelId!);

  const autoThresholdRatio = policy?.autoThresholdRatio ?? getCompactionAutoThresholdRatio();
  const autoReserveCapTokens = policy?.autoReserveCapTokens ?? getCompactionAutoReserveCapTokens();
  const autoSafetyMarginTokens = policy?.autoSafetyMarginTokens ?? getCompactionAutoSafetyMarginTokens();

  const reserve = Math.min(modelMaxOutputTokens, autoReserveCapTokens);
  const ratioBasedThreshold = Math.floor(contextWindow * autoThresholdRatio);
  const safeThreshold = contextWindow - reserve - autoSafetyMarginTokens;

  const threshold = Math.max(0, Math.min(ratioBasedThreshold, safeThreshold));

  return { threshold, contextWindow };
}
