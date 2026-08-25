import type {
  PermissionAsk,
} from '@prokopai/sdk';
import { merge } from './mockHelpers';

// =============================================================================
// PermissionAsk Factory
// =============================================================================

export function createPermissionAsk(
  overrides: Partial<PermissionAsk> = {},
): PermissionAsk {
  return merge<PermissionAsk>(
    {
      type: 'permission',
      question: 'Run command "npm run build" (within workspace): Workspace modification. Requires approval.',
      risk: 'medium',
      resource: 'shell-command',
      scope: {
        type: 'shell-command',
        value: 'npm',
        label: 'npm run',
      },
      patterns: ['npm run build'],
      duration: 'session',
      metadata: {
        command: 'npm run build',
        baseCommand: 'npm',
        riskCategory: 'workspace-modification',
      },
    },
    overrides,
  );
}

// =============================================================================
// Presets — Permission scenarios
// =============================================================================

export const permissionPresets = {
  /** Low-risk file read */
  fileRead: createPermissionAsk({
    question: 'Reading file "package.json" requires approval.',
    risk: 'none',
    resource: 'file',
    paths: ['/project/package.json'],
    patterns: ['file:package.json'],
    duration: 'workspace',
    scope: { type: 'file', value: '/project/package.json', label: 'package.json' },
    metadata: { operation: 'read', path: '/project/package.json' },
  }),

  /** Medium-risk file write */
  fileWrite: createPermissionAsk({
    question: 'Writing file "src/index.ts" requires approval.',
    risk: 'medium',
    resource: 'file',
    paths: ['/project/src/index.ts'],
    patterns: ['file:index.ts', 'file:src/index.ts'],
    duration: 'workspace',
    scope: { type: 'file', value: '/project/src/index.ts', label: 'index.ts' },
    metadata: { operation: 'write', path: '/project/src/index.ts' },
  }),

  /** High-risk destructive shell command */
  destructiveCommand: createPermissionAsk({
    question: 'Run command "rm -rf node_modules" (within workspace): Destructive operation. Requires approval.',
    risk: 'critical',
    resource: 'shell-command',
    patterns: ['rm', 'rm:-rf', 'rm:-r'],
    duration: 'session',
    scope: { type: 'shell-command', value: 'rm', label: 'rm -rf' },
    metadata: {
      command: 'rm -rf node_modules',
      baseCommand: 'rm',
      flags: ['-rf'],
      riskCategory: 'destructive',
    },
  }),

  /** Sensitive file access */
  sensitiveFile: createPermissionAsk({
    question: 'Reading file ".env" (sensitive file) requires approval.',
    risk: 'high',
    resource: 'file',
    paths: ['/project/.env'],
    patterns: ['file:.env', 'sensitive-file'],
    duration: 'session',
    scope: { type: 'file', value: '/project/.env', label: '.env' },
    metadata: { operation: 'read', path: '/project/.env', isSensitiveFile: true },
  }),

  /** Network access (web fetch) */
  networkFetch: createPermissionAsk({
    question: 'Fetch URL "api.example.com" requires approval.',
    risk: 'medium',
    resource: 'network',
    patterns: ['api.example.com', 'https://api.example.com/data'],
    duration: 'workspace',
    scope: { type: 'resource', value: 'https://api.example.com/data', label: 'api.example.com' },
    metadata: { url: 'https://api.example.com/data', host: 'api.example.com' },
  }),

  /** Outside workspace command */
  outsideWorkspace: createPermissionAsk({
    question: 'Command "cat /etc/hosts" runs outside workspace (/etc). Requires approval.',
    risk: 'medium',
    resource: 'shell-command',
    patterns: ['cat', 'cwd:/etc'],
    duration: 'session',
    scope: { type: 'path', value: '/etc', label: 'etc' },
    metadata: { riskCategory: 'outside-workspace', workspaceBound: false },
  }),
} as const;
