import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import * as rootApi from '@capekai/core';
import { capekPackagePhase, createAgent } from '@capekai/core';
import { jean2CompatibilityPhase } from '@capekai/core/compat/jean2';
import * as compositionApi from '@capekai/core/internal/composition';
import * as hostsApi from '@capekai/core/internal/hosts';
import * as executionApi from '@capekai/core/internal/execution';
import * as providersApi from '@capekai/core/internal/providers';
import * as toolsApi from '@capekai/core/internal/tools';
import * as askAuthorityApi from '@capekai/core/internal/ask-authority';
import * as sandboxApi from '@capekai/core/internal/sandbox';
import * as workspaceApi from '@capekai/core/internal/workspace';
import * as configurationApi from '@capekai/core/internal/configuration';
import { createInMemoryConversationStore } from '@capekai/core/storage';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const packageRoot = resolve(repositoryRoot, 'packages/capek');
const packageSourceRoot = resolve(packageRoot, 'src');
const serverSourceRoot = resolve(repositoryRoot, 'packages/server/src');
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
    expect(jean2CompatibilityPhase).toBe(9);
    expect(typeof createAgent).toBe('function');
    expect(typeof createInMemoryConversationStore).toBe('function');
  });

  test('root exports only the facade and package marker values', () => {
    expect(Object.keys(rootApi).sort()).toEqual(['capekPackagePhase', 'createAgent']);
    expect('handleChat' in rootApi).toBe(false);
    expect('setJean2CompatibilityBindings' in rootApi).toBe(false);
    expect('streamChatWithRetry' in rootApi).toBe(false);
  });

  test('internal composition subpath exposes exactly the narrow composition surface', () => {
    expect(Object.keys(compositionApi).sort()).toEqual([
      'C2_PROCESS_KEYS',
      'C2_REQUIRED_AGENT_KEYS',
      'C2_SERVICE_KEYS',
      'JEAN2_AGENT_PLUGIN_IDS',
      'JEAN2_PROCESS_PLUGIN_IDS',
      'JEAN2_PROFILE_ID',
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
      'capekToolSourceKey',
      'createCurrentAgentScope',
      'createCurrentProcessScope',
      'createJean2AgentScope',
      'createJean2ProcessScope',
      'enterAgentScope',
    ].sort());
    expect(typeof compositionApi.createCurrentProcessScope).toBe('function');
    expect(typeof compositionApi.createCurrentAgentScope).toBe('function');
    expect(typeof compositionApi.createJean2ProcessScope).toBe('function');
    expect(typeof compositionApi.createJean2AgentScope).toBe('function');
    expect(typeof compositionApi.enterAgentScope).toBe('function');
    expect(typeof compositionApi.capekStorageKey.id).toBe('string');
    expect(typeof compositionApi.capekContextAssemblerKey.id).toBe('string');
  });

  test('internal hosts subpath exposes exactly the host configuration surface', () => {
    expect(Object.keys(hostsApi).sort()).toEqual([
      'configureAgentSource',
      'configureInstructionSource',
      'configurePreconfigSource',
      'configureRuntimeHost',
      'configureSchedulerHost',
      'configureSessionSearchHost',
      'getRuntimeHost',
      'installMemoryToolFallback',
      'installSchedulerToolFallback',
      'installSessionSearchToolFallback',
      'installSkillsToolFallback',
      'installTaskToolFallback',
      'installWorkflowToolFallback',
      'withRuntimeHost',
    ].sort());
  });

  test('internal execution subpath exposes exactly the execution surface', () => {
    expect(Object.keys(executionApi).sort()).toEqual([
      'executeCompaction',
      'forkSession',
      'handleChat',
      'handleSessionEditMessage',
      'interruptManager',
      'reconcileAllSessionsCompactionWithDeps',
      'reconcileSessionCompactionWithDeps',
      'regenerateSessionTitle',
      'revertToStep',
    ].sort());
  });

  test('internal providers subpath exposes exactly the provider surface', () => {
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
    ].sort());
  });

  test('internal tools subpath exposes exactly the tool surface', () => {
    expect(Object.keys(toolsApi).sort()).toEqual([
      'ArtifactError',
      'clearCache',
      'configureToolSource',
      'configureToolsPath',
      'downloadArtifact',
      'extractArtifact',
      'getTool',
      'listTools',
      'readInstallManifest',
      'scanTools',
      'validateArtifactStructure',
      'verifyChecksum',
      'writeInstallManifest',
    ].sort());
  });

  test('internal ask-authority subpath exposes exactly the pending-ask surface', () => {
    expect(Object.keys(askAuthorityApi).sort()).toEqual([
      'ASK_TIMEOUT',
      'getAuthorityForPendingAsk',
      'getSessionIdForPendingAsk',
      'resolveAsk',
    ].sort());
  });

  test('internal sandbox subpath exposes exactly the sandbox surface', () => {
    expect(Object.keys(sandboxApi).sort()).toEqual([
      'SandboxController',
      'SandboxProvider',
      'sandboxController',
    ].sort());
  });

  test('internal workspace subpath exposes exactly the workspace policy surface', () => {
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

  test('internal configuration subpath exposes exactly the runtime configuration surface', () => {
    expect(Object.keys(configurationApi).sort()).toEqual([
      'configureRuntimeConfiguration',
      'getApiKeyForProvider',
      'getRuntimeConfiguration',
      'withRuntimeConfiguration',
    ].sort());
  });

  test('Phase 8 runtime uses package-owned host seams', () => {
    const violations = collectSourceFiles(packageSourceRoot)
      .filter((path) => !path.includes(`${sep}compat${sep}`))
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

  test('tool workspace policy files do not import Jean2 compatibility wrappers', () => {
    const policyFiles = [
      resolve(packageSourceRoot, 'tools/executor.ts'),
      resolve(packageSourceRoot, 'tools/workspace-capability.ts'),
    ];
    const violations = policyFiles.flatMap((path) => collectImports(path)
      .filter((specifier) => specifier.includes('compat/jean2-dependencies'))
      .map((specifier) => `${relative(repositoryRoot, path)} imports ${specifier}`));

    expect(violations).toEqual([]);
  });

  test('package runtime storage does not use Jean2 compatibility storage wrappers', () => {
    const violations: string[] = [];
    for (const path of collectSourceFiles(packageSourceRoot)) {
      if (path.endsWith('compat/jean2-dependencies.ts')) continue;
      for (const specifier of collectImports(path)) {
        if (specifier.includes('compat/jean2-dependencies')) {
          const sourceFile = ts.createSourceFile(
            path,
            readFileSync(path, 'utf8'),
            ts.ScriptTarget.Latest,
            true,
          );
          const declaration = sourceFile.statements.find(statement =>
            ts.isImportDeclaration(statement)
            && ts.isStringLiteral(statement.moduleSpecifier)
            && statement.moduleSpecifier.text.includes('compat/jean2-dependencies'));
          if (!declaration || !ts.isImportDeclaration(declaration)) continue;
          const importedNames = declaration.importClause?.namedBindings
            && ts.isNamedImports(declaration.importClause.namedBindings)
            ? declaration.importClause.namedBindings.elements.map(element => element.name.text)
            : [];
          const storageNames = new Set([
            'createSession', 'createMessage', 'getMessage', 'getMessageWithParts', 'deleteMessage',
            'updateMessage', 'getSession', 'updateSession', 'transitionToolToInterrupted',
            'syncMessageFts', 'getPartsByMessage', 'createPart', 'updatePart', 'getPart',
            'persistStreamingPartSnapshots', 'getAttachment', 'getWorkspace',
            'transitionToolToRunningByCallId', 'getChildSessions', 'listMessagesWithParts',
            'listLatestMessagesWithPartsPage', 'getPartsBySession', 'buildEffectiveContextHistory',
            'addMessageToQueue', 'deleteQueuedMessage', 'getNextQueuedMessage',
            'getResponseFormat', 'getWorkspaceAutoApproveSeverity',
          ]);
          if (importedNames.some(name => storageNames.has(name))) violations.push(relative(repositoryRoot, path));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('Phase 8 package runtime does not import completed Jean2 compatibility seams', () => {
    const phase6Names = new Set([
      'resolveToolsPath', 'readInstallManifest',
      'findModel', 'findModelVariant', 'getMaxOutputTokens', 'getModelsConfig',
      'getLLMTemperature', 'getLLMMaxSteps', 'getLLMSubagentMaxSteps',
      'getLLMBaseUrl', 'getLLMOpenAIApiKey', 'getLLMOpenRouterApiKey',
      'getLLMMinimaxApiKey', 'getLLMZhipuApiKey', 'getLLMZhipuCodingApiKey',
      'getLLMDeepseekApiKey', 'getCompactionModel', 'getCompactionProvider',
      'getCompactionMaxTokens', 'getCompactionPreserveRecentToolCount',
      'getCompactionPreserveSmallToolChars', 'getCompactionToolClearCharsThreshold',
      'getCompactionMaxPrunedToolCount', 'getCompactionAutoThresholdRatio',
      'getCompactionAutoReserveCapTokens', 'getCompactionAutoSafetyMarginTokens',
      'getPreconfig', 'getDefaultPreconfig', 'getPreconfigOrAgent',
      'listPreconfigs', 'listSubagentPreconfigs', 'getAgentDirectory',
      'readAgentMemoryFile', 'initializeWorkspace', 'getMcpTools',
      'memoryToolDefinition', 'executeMemoryTool', 'loadMemoryInstructions',
      'getMemoryGuidance', 'getSkillManageToolDefinition', 'executeSkillManageTool',
      'buildSkillManageToolDescription', 'createSkillTool', 'getSkillManageGuidance',
      'getSessionSearchToolDefinition', 'executeSessionSearchTool',
      'getSessionSearchGuidance', 'getSchedulerToolDefinition', 'executeSchedulerTool',
      'buildWorkspaceSystemPrompt', 'loadInstructions', 'formatInstructions',
      'getSandboxController',
    ]);
    const violations: string[] = [];

    for (const path of collectSourceFiles(packageSourceRoot)) {
      if (path.endsWith('compat/jean2-dependencies.ts')) continue;
      const sourceFile = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement)
          || !ts.isStringLiteral(statement.moduleSpecifier)
          || !statement.moduleSpecifier.text.includes('compat/jean2-dependencies')) continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements) {
          if (phase6Names.has(element.name.text)) {
            violations.push(`${relative(repositoryRoot, path)} imports ${element.name.text}`);
          }
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
      .filter((path) => !path.includes(`${sep}compat${sep}`))
      .flatMap((path) => collectImports(path)
        .filter((specifier) => forbiddenModuleFragments.some((fragment) => specifier.includes(fragment)))
        .map((specifier) => `${relative(repositoryRoot, path)} imports ${specifier}`));

    expect(violations).toEqual([]);
  });

  test('package source does not import Jean2 server internals', () => {
    const violations: string[] = [];

    for (const path of collectSourceFiles(packageSourceRoot)) {
      for (const specifier of collectImports(path)) {
        const importsServerPackage = specifier === '@jean2/server'
          || specifier.startsWith('@jean2/server/');
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
