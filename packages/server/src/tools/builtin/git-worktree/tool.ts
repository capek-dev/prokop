import type { ToolDefinition, ToolContext, ToolResult } from '@prokopai/sdk';
import type { ShellOutputVisualization } from '@prokopai/sdk';
import { resolve, join } from 'path';
import { getDataDir } from '@/infrastructure/runtime/paths';

type Action = 'create' | 'list' | 'status' | 'remove';

interface Input {
  action: Action;
  branch?: string;
  path?: string;
  base?: string;
}

const DEFAULT_BASE_BRANCH = 'main';

export const definition: ToolDefinition = {
  name: 'git-worktree',
  description: `Manage git worktrees for parallel development across multiple sessions.

This tool creates isolated working directories (git worktrees) that share the same repository but have their own branch, HEAD, and working files. This enables multiple sessions to work on different tickets simultaneously without filesystem collisions.

## When to use

- Starting work on a new ticket: create a worktree with a feature branch
- Checking the state of existing worktrees across your workspace
- Cleaning up after a PR is merged: remove the worktree and unregister its path

## Actions

- **create**: Creates a worktree at a deterministic path and registers it as an additional workspace path. Requires a branch name.
- **list**: Lists all worktrees in the current repository.
- **status**: Shows git status (short format) for a specific worktree.
- **remove**: Removes a worktree and unregisters its path from the workspace. Requires explicit user approval.

## Path registration

When creating a worktree, the new path is automatically added to the workspace's additional paths so that all subsequent tool calls (edit, read-file, grep, etc) can access it without per-call permission prompts. When removing, the path is unregistered.

## Permission Model

- **create**, **list**, **status**: Auto-approved (read/local operations)
- **remove**: Requires explicit user approval via ctx.ask()`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'status', 'remove'],
        description: 'The worktree operation to perform',
      },
      branch: {
        type: 'string',
        description: 'Branch name for create (the branch to create and check out in the new worktree). Required for create.',
      },
      path: {
        type: 'string',
        description: 'Explicit path for the worktree directory. If omitted for create, a deterministic path is derived from the branch name. For status/remove, specifies which worktree (defaults to cwd).',
      },
      base: {
        type: 'string',
        description: `Base branch to create the new branch from. Defaults to '${DEFAULT_BASE_BRANCH}'.`,
      },
    },
    required: ['action'],
  },
  timeout: 30000,
};

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runGit(args: string[], cwd: string): Promise<GitResult> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

function sanitizeBranchName(branch: string): string {
  return branch.trim().replace(/\s+/g, '-').replace(/[^\w./-]/g, '');
}

function deriveWorktreePath(branch: string): string {
  const safeName = sanitizeBranchName(branch).split('/').join('-');
  return join(getDataDir(), 'worktrees', safeName);
}

function makeShellVisualization(command: string, git: GitResult): ShellOutputVisualization {
  return {
    type: 'shell-output',
    command: `git ${command}`.substring(0, 100),
    stdout: git.stdout || undefined,
    stderr: git.stderr || undefined,
    exitCode: git.exitCode,
  };
}

export async function execute(input: Input, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (input.action) {
      case 'create':
        return await handleCreate(input, ctx);
      case 'list':
        return await handleList(ctx);
      case 'status':
        return await handleStatus(input, ctx);
      case 'remove':
        return await handleRemove(input, ctx);
      default:
        return { success: false, error: `Unknown action: ${input.action}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

async function handleCreate(input: Input, ctx: ToolContext): Promise<ToolResult> {
  if (!input.branch) {
    return { success: false, error: 'BRANCH_REQUIRED: create action requires a branch name' };
  }

  const branch = sanitizeBranchName(input.branch);
  const base = input.base || DEFAULT_BASE_BRANCH;
  const worktreePath = input.path ? resolve(input.path) : deriveWorktreePath(branch);

  if (ctx.isBlockedPath(worktreePath)) {
    return { success: false, error: `BLOCKED_PATH: ${worktreePath} is a system path and cannot be used` };
  }

  const gitDirResult = await runGit(['rev-parse', '--is-inside-work-tree'], ctx.workspacePath);
  if (gitDirResult.exitCode !== 0) {
    return {
      success: false,
      error: `NOT_A_GIT_REPO: ${gitDirResult.stderr || 'workspace is not inside a git repository'}`,
    };
  }

  const branchResult = await runGit(['rev-parse', '--verify', `refs/heads/${branch}`], ctx.workspacePath);
  const branchExists = branchResult.exitCode === 0;

  const createArgs = branchExists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, base];

  const command = branchExists ? `worktree add ${worktreePath} ${branch}` : `worktree add -b ${branch} ${worktreePath} ${base}`;
  const result = await runGit(createArgs, ctx.workspacePath);

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `GIT_FAILED: ${result.stderr || result.stdout || 'git worktree add failed'}`,
      result: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
      visualization: makeShellVisualization(command, result),
    };
  }

  const registered = await ctx.addWorkspacePath(worktreePath);

  const message = branchExists
    ? `Created worktree for existing branch '${branch}' at ${worktreePath}`
    : `Created worktree with new branch '${branch}' (from ${base}) at ${worktreePath}`;

  return {
    success: true,
    result: {
      action: 'create',
      branch,
      base: branchExists ? undefined : base,
      path: worktreePath,
      registered: registered ? 'workspace additional path registered' : 'no workspace to register path (session has no workspaceId)',
      isNewBranch: !branchExists,
    },
    visualization: {
      ...makeShellVisualization(command, result),
      stdout: message,
    },
  };
}

async function handleList(ctx: ToolContext): Promise<ToolResult> {
  const result = await runGit(['worktree', 'list', '--porcelain'], ctx.workspacePath);

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `GIT_FAILED: ${result.stderr || 'git worktree list failed'}`,
      visualization: makeShellVisualization('worktree list --porcelain', result),
    };
  }

  const worktrees = parseWorktreeList(result.stdout);

  return {
    success: true,
    result: { action: 'list', worktrees },
    visualization: makeShellVisualization('worktree list --porcelain', result),
  };
}

interface WorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  bare?: boolean;
}

function parseWorktreeList(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (!line.trim()) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = {};
      continue;
    }

    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');

    if (key === 'worktree') current.path = value;
    else if (key === 'HEAD') current.head = value;
    else if (key === 'branch') current.branch = value;
    else if (key === 'bare') current.bare = true;
  }

  if (current.path) {
    worktrees.push(current as WorktreeInfo);
  }

  return worktrees;
}

async function handleStatus(input: Input, ctx: ToolContext): Promise<ToolResult> {
  const targetPath = input.path ? resolve(input.path) : ctx.workspacePath;

  if (!ctx.isWithinWorkspace(targetPath)) {
    return { success: false, error: `OUTSIDE_WORKSPACE: ${targetPath} is not within the workspace or its additional paths` };
  }

  const result = await runGit(['status', '--short', '--branch'], targetPath);

  if (result.exitCode !== 0) {
    return {
      success: false,
      error: `GIT_FAILED: ${result.stderr || 'git status failed'}`,
      visualization: makeShellVisualization('status --short --branch', result),
    };
  }

  return {
    success: true,
    result: { action: 'status', path: targetPath, output: result.stdout },
    visualization: makeShellVisualization('status --short --branch', result),
  };
}

async function handleRemove(input: Input, ctx: ToolContext): Promise<ToolResult> {
  if (!input.path) {
    return { success: false, error: 'PATH_REQUIRED: remove action requires a path' };
  }

  const worktreePath = resolve(input.path);

  if (!ctx.isWithinWorkspace(worktreePath)) {
    return { success: false, error: `OUTSIDE_WORKSPACE: ${worktreePath} is not within the workspace or its additional paths` };
  }

  const approved = await ctx.ask({
    type: 'permission',
    question: `Remove git worktree at ${worktreePath}?`,
    description: 'This will run git worktree remove and unregister the path from the workspace. The branch is NOT deleted.',
    risk: 'medium',
    resource: 'shell-command',
    action: 'execute',
    scope: {
      type: 'path',
      value: worktreePath,
      label: worktreePath.split('/').pop() || worktreePath,
    },
    patterns: [`git worktree remove ${worktreePath}`],
    duration: 'once',
    metadata: {
      command: `git worktree remove ${worktreePath}`,
      baseCommand: 'git worktree remove',
      riskCategory: 'workspace-modification',
    },
  });

  if (!approved) {
    return { success: false, error: 'USER_REJECTION' };
  }

  let result = await runGit(['worktree', 'remove', worktreePath], ctx.workspacePath);

  if (result.exitCode !== 0) {
    const forceResult = await runGit(['worktree', 'remove', '--force', worktreePath], ctx.workspacePath);
    if (forceResult.exitCode !== 0) {
      return {
        success: false,
        error: `GIT_FAILED: ${result.stderr || forceResult.stderr || 'git worktree remove failed (even with --force)'}`,
        result: { stdout: forceResult.stdout, stderr: forceResult.stderr, exitCode: forceResult.exitCode },
        visualization: makeShellVisualization('worktree remove --force', forceResult),
      };
    }
    result = forceResult;
  }

  await ctx.removeWorkspacePath(worktreePath);

  return {
    success: true,
    result: {
      action: 'remove',
      path: worktreePath,
      output: result.stdout,
      unregistered: 'path removed from workspace additional paths',
    },
    visualization: makeShellVisualization('worktree remove', result),
  };
}
