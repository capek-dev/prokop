import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import * as rootApi from '@capekai/core';
import { capekPackagePhase } from '@capekai/core';
import * as compositionApi from '@capekai/core/composition';
import * as hostsApi from '@capekai/core/hosts';
import * as executionApi from '@capekai/core/execution';
import * as providersApi from '@capekai/core/providers';
import * as toolsApi from '@capekai/core/tools';
import * as askAuthorityApi from '@capekai/core/ask-authority';
import * as sandboxApi from '@capekai/core/sandbox';
import * as workspaceApi from '@capekai/core/workspace';
import * as configurationApi from '@capekai/core/configuration';
import { createInMemoryConversationStore } from '@capekai/core/storage';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const packageRoot = resolve(repositoryRoot, 'packages/capek');
const packageSourceRoot = resolve(packageRoot, 'src');
const serverSourceRoot = resolve(repositoryRoot, 'packages/server/src');
const jean2ServerPackage = ['@jean2', '/server'].join('');
const ignoredDirectories = new Set([
  '.git',
  '.architecture-specs',
  'build',
  'client-dist',
  'coverage',
  'dev-dist',
  'dist',
  'node_modules',
  'storybook-static',
]);
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'];

function isWithin(path: string, parent: string): boolean {
  const relativePath = relative(parent, path);
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..');
}

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }

    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (sourceExtensions.some((extension) => path.endsWith(extension))) {
      files.push(path);
    }
  }

  return files;
}

function collectImports(path: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];

  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';

      if (isDynamicImport || isRequire) {
        imports.push(node.arguments[0].text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function resolvesWithin(specifier: string, importer: string, target: string): boolean {
  return specifier.startsWith('.') && isWithin(resolve(dirname(importer), specifier), target);
}

describe('package boundary', () => {
  test('declared package entrypoints import by package name', () => {
    expect(capekPackagePhase).toBe(9);
    expect(typeof createInMemoryConversationStore).toBe('function');
  });

  test('root exports only type re-exports and the package marker value', () => {
    expect(Object.keys(rootApi).sort()).toEqual(['capekPackagePhase']);
    expect('handleChat' in rootApi).toBe(false);
    expect('createAgent' in rootApi).toBe(false);
    expect('setJean2CompatibilityBindings' in rootApi).toBe(false);
    expect('streamChatWithRetry' in rootApi).toBe(false);
  });

  test('composition subpath exposes exactly the narrow composition surface', () => {
    expect(Object.keys(compositionApi).sort()).toEqual([
      'C2_PROCESS_KEYS',
      'C2_REQUIRED_AGENT_KEYS',
      'C2_SERVICE_KEYS',
      'capekAgentDriverKey',
      'capekContextAssemblerKey',
      'capekContextSourcesKey',
      'capekInstalledToolRegistryKey',
      'capekProviderOverridesKey',
      'capekProviderRegistryKey',
      'capekRuntimeConfigurationKey',
      'capekRuntimeHostKey',
      'capekSandboxControllerKey',
      'capekSchedulerHostKey',
      'capekSessionSearchHostKey',
      'capekStorageKey',
      'capekToolResolverKey',
      'capekWorkspaceToolDiscoveryKey',
      'createAgentScope',
      'createComposition',
      'createProcessScope',
      'enterAgentScope',
      'facadeProcessPlugins',
    ].sort());
    expect(typeof compositionApi.createProcessScope).toBe('function');
    expect(typeof compositionApi.createAgentScope).toBe('function');
    expect(typeof compositionApi.enterAgentScope).toBe('function');
    expect(typeof compositionApi.capekStorageKey.id).toBe('string');
    expect(typeof compositionApi.capekContextAssemblerKey.id).toBe('string');
  });


  test('hosts subpath exposes exactly the host configuration surface', () => {
    expect(Object.keys(hostsApi).sort()).toEqual([
      'addEntry',
      'buildSkillManageToolDescription',
      'configureAgentSource',
      'configureInstructionSource',
      'configurePreconfigSource',
      'configureRuntimeHost',
      'configureSchedulerHost',
      'configureSessionSearchHost',
      'createStandaloneHost',
      'entriesToContent',
      'executeMemoryTool',
      'executeSchedulerTool',
      'executeSessionSearchTool',
      'executeSkillManageTool',
      'formatEntriesForDisplay',
      'formatMemorySection',
      'getRuntimeHost',
      'getSchedulerHost',
      'getSessionSearchHost',
      'installMemoryToolFallback',
      'installSchedulerToolFallback',
      'installSessionSearchToolFallback',
      'installSkillsToolFallback',
      'fixedBuilderContextAssembler',
      'setDefaultContextAssembler',
      'installTaskToolFallback',
      'installWorkflowToolFallback',
      'listEntries',
      'loadMemoryFile',
      'loadMemoryInstructions',
      'MEMORY_CHAR_LIMIT',
      'parseEntries',
      'removeEntry',
      'replaceEntry',
      'USER_CHAR_LIMIT',
      'withRuntimeHost',
    ].sort());
  });

  test('execution subpath exposes exactly the execution surface', () => {
    expect(Object.keys(executionApi).sort()).toEqual([
      'ApiErrorType',
      'buildAiSdkTools',
      'buildContinuationMessage',
      'buildConversationText',
      'buildSchemaPromptInstruction',
      'buildStreamConfig',
      'buildSystemMessage',
      'classifyApiError',
      'collectSubagentAncestry',
      'convertToAiSdkMessages',
      'createCompactionTrigger',
      'createErrorEvent',
      'createRetryCircuitState',
      'createStepCallbacks',
      'createStepPart',
      'createStreamHandlers',
      'createWorkspaceCapability',
      'estimateToolOutputSize',
      'evaluateSubagentTarget',
      'executeCompaction',
      'extractJsonFromText',
      'forkSession',
      'formatOutput',
      'getDefaultCompactionPolicy',
      'getSubagentResumeError',
      'getModelWithMetadata',
      'handleChat',
      'handleSessionEditMessage',
      'interruptManager',
      'isCompactionActive',
      'isFilePart',
      'isImagePart',
      'isSubagentSpawningDisabled',
      'isTextPart',
      'isToolAllowedInContext',
      'isToolPart',
      'isValidSubagentPreconfig',
      'isValidSubagentTargetPreconfig',
      'parseToolInput',
      'persistCompactionFailure',
      'processCompactionTask',
      'reconcileAllSessionsCompactionWithDeps',
      'reconcileSessionCompactionWithDeps',
      'regenerateSessionTitle',
      'resolveCompactionPolicy',
      'resolveToolExecutionScopes',
      'revertToStep',
      'runOrchestratorSession',
      'streamChatWithRetry',
      'withRetry',
      'withRetryCircuitState',
    ].sort());
  });

  test('providers subpath exposes exactly the provider surface', () => {
    expect(Object.keys(providersApi).sort()).toEqual([
      'connectProvider',
      'createCapabilityTool',
      'createModelForProvider',
      'createOpenAiResponsesModel',
      'disconnectProvider',
      'executeChildSession',
      'findProviderFromModel',
      'getConnectableProviders',
      'getProvider',
      'getProviderStatus',
      'registerProvider',
      'runTextModel',
      'withProviderOverrides',
    ].sort());
  });

  test('tools subpath exposes exactly the tool surface', () => {
    expect(Object.keys(toolsApi).sort()).toEqual([
      'ArtifactError',
      'RETRIEVE_TOOL_OUTPUT_NAME',
      'clearCache',
      'configureWorkspaceToolDiscovery',
      'configureToolsPath',
      'downloadArtifact',
      'extractArtifact',
      'extractVisualization',
      'getInstalledTool',
      'getManifestPath',
      'getTool',
      'getWorkspaceToolDiscovery',
      'hasUnscannedToolCache',
      'listDomainToolFallbackDefinitions',
      'listInstalledTools',
      'listTools',
      'loadToolModule',
      'readInstallManifest',
      'scanTools',
      'stripVisualization',
      'validateArtifactStructure',
      'verifyChecksum',
      'writeInstallManifest',
    ].sort());
  });

  test('ask-authority subpath exposes exactly the pending-ask surface', () => {
    expect(Object.keys(askAuthorityApi).sort()).toEqual([
      'ASK_TIMEOUT',
      'createAskApi',
      'getAuthorityForPendingAsk',
      'getPendingRequestsByRootSession',
      'getSessionIdForPendingAsk',
      'hasPendingAsk',
      'hasPendingWaiter',
      'rejectPendingAsksByToolCallId',
      'rejectPermission',
      'rejectPermissionsBySession',
      'requestPermission',
      'resolveAsk',
      'resolvePermission',
    ].sort());
  });

  test('sandbox subpath exposes exactly the sandbox surface', () => {
    expect(Object.keys(sandboxApi).sort()).toEqual([
      'SandboxController',
      'SandboxLanguageModel',
      'SandboxProvider',
      'sandboxController',
    ].sort());
  });

  test('workspace subpath exposes exactly the workspace policy surface', () => {
    expect(Object.keys(workspaceApi).sort()).toEqual([
      'expandPath',
      'isInsideUnselectedAdditionalRoot',
      'isPathInside',
      'isPathWithinWorkspace',
      'resolveCandidatePath',
      'resolvePath',
      'resolveRootForQuery',
      'selectEditableRoot',
    ].sort());
  });

  test('configuration subpath exposes exactly the runtime configuration surface', () => {
    expect(Object.keys(configurationApi).sort()).toEqual([
      'configureRuntimeConfiguration',
      'createDefaultRuntimeConfiguration',
      'createSingleModelConfiguration',
      'getApiKeyForProvider',
      'getRuntimeConfiguration',
      'resolveModelSpecifier',
      'withRuntimeConfiguration',
    ].sort());
  });

  test('package runtime imports no compat modules (S8e retirement)', () => {
    const violations = collectSourceFiles(packageSourceRoot)
      .flatMap((path) => collectImports(path)
        .filter((specifier) => specifier.includes('compat/'))
        .map((specifier) => `${relative(repositoryRoot, path)} imports ${specifier}`));

    expect(violations).toEqual([]);
  });

  test('external source does not import package internals', () => {
    const violations: string[] = [];

    for (const path of collectSourceFiles(repositoryRoot)) {
      if (isWithin(path, packageRoot)) {
        continue;
      }

      for (const specifier of collectImports(path)) {
        const importsSourcePath = specifier.includes('packages/capek/src');
        const importsPrivateSubpath = specifier === '@capekai/core/src'
          || specifier.startsWith('@capekai/core/src/');
        const resolvesIntoSource = resolvesWithin(specifier, path, packageSourceRoot);

        if (importsSourcePath || importsPrivateSubpath || resolvesIntoSource) {
          violations.push(`${relative(repositoryRoot, path)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });


  test('package runtime imports no Jean2 delivery or hosting modules', () => {
    const forbiddenModuleFragments = [
      'core/broadcast',
      'core/message-router',
      'core/router-context',
      'services/notification',
      'services/web-push',
    ];
    const violations = collectSourceFiles(packageSourceRoot)
      .flatMap((path) => collectImports(path)
        .filter((specifier) => forbiddenModuleFragments.some((fragment) => specifier.includes(fragment)))
        .map((specifier) => `${relative(repositoryRoot, path)} imports ${specifier}`));

    expect(violations).toEqual([]);
  });

  test('package source does not import Jean2 server internals', () => {
    const violations: string[] = [];

    for (const path of collectSourceFiles(packageSourceRoot)) {
      for (const specifier of collectImports(path)) {
        const importsServerPackage = specifier === jean2ServerPackage
          || specifier.startsWith(`${jean2ServerPackage}/`);
        const importsServerSourcePath = specifier.includes('packages/server/src');
        const resolvesIntoServerSource = resolvesWithin(specifier, path, serverSourceRoot);

        if (importsServerPackage || importsServerSourcePath || resolvesIntoServerSource) {
          violations.push(`${relative(repositoryRoot, path)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
