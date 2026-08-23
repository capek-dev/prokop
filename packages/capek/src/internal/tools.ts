/**
 * Public tools entrypoint (`@capekai/core/tools`).
 *
 * Exposes exactly the tool-registry and artifact identities the Jean2
 * server consumes: scanning, listing, tool-path configuration, the tool
 * source lifecycle, artifact download/verification/extraction, and install
 * manifests. Every symbol resolves to the owning module's identity,
 * identical to the compatibility barrel. S8a.
 */

export {
  clearCache,
  configureToolsPath,
  getInstalledTool,
  getTool,
  hasUnscannedToolCache,
  listInstalledTools,
  listTools,
  loadToolModule,
  scanTools,
} from '../tools/registry';
export type { ToolRegistryResolver } from '../tools/registry';
export { RETRIEVE_TOOL_OUTPUT_NAME } from '../tool-output/policy';
export {
  configureWorkspaceToolDiscovery,
  getWorkspaceToolDiscovery,
  type WorkspaceToolDiscovery,
} from '../tools/tool-source';
export {
  ArtifactError,
  downloadArtifact,
  extractArtifact,
  validateArtifactStructure,
  verifyChecksum,
} from '../tools/tool-artifact';
export {
  getManifestPath,
  readInstallManifest,
  writeInstallManifest,
  type InstallManifest,
} from '../tools/install-manifest';
export {
  stripVisualization,
  extractVisualization,
} from '../utils/strip-visualization';
export {
  listDomainToolFallbackDefinitions,
} from '../runtime/domain-tool-source';
