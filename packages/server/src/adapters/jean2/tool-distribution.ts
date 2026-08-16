import type {
  ToolDistributionPort,
  ToolRepositoryPort,
} from '@/application/ports/tool-distribution';
import {
  createToolDistribution,
  createToolRepository,
} from '@/infrastructure/tools/distribution';

export function createJean2ToolDistributionPort(): ToolDistributionPort {
  return createToolDistribution();
}

export function createJean2ToolRepositoryPort(): ToolRepositoryPort {
  return createToolRepository();
}
