import { getDefaultToolsPath, resolveToolsPath } from '@/config';
import type {
  ToolDistributionPort,
  ToolRepositoryPort,
} from '@/application/ports/tool-distribution';
import {
  clearCache,
  getInstalledTools,
  getInstalledToolVersion,
  getToolInstallDir,
  installTool,
  installToolFromUrl,
  isToolInstalled,
  removeTool,
} from '@/tools/tool-installer';
import {
  collectEnvVars,
  fetchRepository,
  fetchRepositoryWithVersions,
  getToolByName,
} from '@/tools/tool-repository';

export function createToolDistribution(): ToolDistributionPort {
  return {
    installTool,
    installToolFromUrl,
    removeTool,
    getInstalledTools,
    isToolInstalled,
    getInstalledToolVersion,
    clearCache,
    toolsBaseDir: resolveToolsPath,
    defaultToolsBaseDir: getDefaultToolsPath,
    toolInstallDir: getToolInstallDir,
  };
}

export function createToolRepository(): ToolRepositoryPort {
  return {
    fetchRepository,
    fetchRepositoryWithVersions,
    collectEnvVars,
    getToolByName,
  };
}
