import { resolveToolsPath, getDefaultToolsPath } from '@/config';
import {
  clearCache as clearInstallerCache,
  getInstalledTools,
  getInstalledToolVersion,
  getToolInstallDir,
  installTool,
  installToolFromUrl,
  isToolInstalled,
  removeTool,
} from '@/tools/tool-installer';
import {
  collectEnvVars as repositoryCollectEnvVars,
  fetchRepository,
  fetchRepositoryWithVersions,
  getToolByName,
} from '@/tools/tool-repository';
import type {
  ToolDistributionPort,
  ToolRepositoryPort,
} from '@/application/ports/tool-distribution';

/**
 * Jean2 tool distribution adapters (S4/S5). These wrap the current
 * filesystem installer and the network repository implementations with
 * their exact identities; the installation metadata and release policy
 * lives in the tool-installation domain, consumed by the wrapped
 * implementations.
 */

export function createJean2ToolDistributionPort(): ToolDistributionPort {
  return {
    installTool,
    installToolFromUrl,
    removeTool,
    getInstalledTools,
    isToolInstalled,
    getInstalledToolVersion,
    clearCache: clearInstallerCache,
    toolsBaseDir: resolveToolsPath,
    defaultToolsBaseDir: getDefaultToolsPath,
    toolInstallDir: getToolInstallDir,
  };
}

export function createJean2ToolRepositoryPort(): ToolRepositoryPort {
  return {
    fetchRepository,
    fetchRepositoryWithVersions,
    collectEnvVars: repositoryCollectEnvVars,
    getToolByName,
  };
}
