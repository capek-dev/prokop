/**
 * Internal tools entrypoint (`@capekai/core/internal/tools`).
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
  getTool,
  listTools,
  scanTools,
} from '../tools/registry';
export {
  configureToolSource,
  getToolSource,
  type ToolSourceLifecycle,
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
