import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PullRequestRepository } from '@prokopai/sdk/types';
import { BadRequestError } from '@/application/http-errors';

export interface CliRequest {
  command: 'gh' | 'az';
  args: string[];
  cwd: string;
  input?: string;
}
export type RunCli = (request: CliRequest) => Promise<string>;

/** Bound both subprocess lifetime and output, including inherited pipe handles. */
export const runCli: RunCli = ({ command, args, cwd, input }) =>
  new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      GH_PROMPT_DISABLED: '1',
      GH_PAGER: 'cat',
      GH_DEBUG: '',
      AZURE_CORE_NO_COLOR: '1',
      AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no',
      GIT_TERMINAL_PROMPT: '0',
    };
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    let finished = false;
    const finish = (error?: Error, result = '') => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const stop = (message: string) => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      finish(new BadRequestError(message));
    };
    const timer = setTimeout(
      () =>
        stop(
          'Provider command timed out. Refresh the PR before retrying; the remote action may have completed.',
        ),
      60_000,
    );
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024)
        stop('Provider response exceeded the size limit. Open this request on the provider website.');
      else target.push(chunk);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.stdin.on('error', () => {});
    child.on('error', () =>
      finish(
        new BadRequestError(
          command === 'gh'
            ? 'Install GitHub CLI (gh) on the Prokop server and run gh auth login.'
            : 'Install Azure CLI (az) on the Prokop server, add the azure-devops extension, and sign in.',
        ),
      ),
    );
    child.on('close', (code) => {
      if (code === 0) {
        finish(undefined, Buffer.concat(out).toString());
        return;
      }
      // Classify stderr without exposing provider output, URLs, credentials, or request bodies.
      const stderr = Buffer.concat(err).toString();
      const message = /429|rate.limit|throttl/i.test(stderr)
        ? 'Provider rate limit reached. Wait before refreshing.'
        : command === 'az' && /has not been materialized/i.test(stderr)
          ? 'Sign in to this Azure DevOps organization in your browser using the same account as Azure CLI, then rescan connections.'
          : /401|not logged|authentication|az login|devops login|gh auth login/i.test(stderr)
            ? command === 'gh'
              ? 'Sign in on the Prokop server with gh auth login.'
              : 'Sign in on the Prokop server with az login or az devops login.'
            : /403|forbidden|permission|policy|protected/i.test(stderr)
              ? 'The provider refused this operation. Check your permissions and repository policies.'
              : /extension|not recognized|misspelled/i.test(stderr) && command === 'az'
                ? 'Install the Azure DevOps extension on the server: az extension add --name azure-devops.'
                : 'Provider command failed. Check server CLI authentication and PR state. Refresh before retrying a write.';
      finish(new BadRequestError(message));
    });
    child.stdin.end(input);
  });

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestError('Provider returned an invalid object.');
  return value as Record<string, unknown>;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new BadRequestError('Provider returned an invalid list.');
  return value;
}
export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function required(value: unknown): string {
  const result = str(value);
  if (!result) throw new BadRequestError('Provider response is missing a required field.');
  return result;
}
export function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new BadRequestError('Provider returned an invalid number.');
  return value;
}
export function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError('Provider returned invalid JSON.');
  }
}

export function githubApi(run: RunCli, cwd: string) {
  return async (path: string, method = 'GET', body?: unknown): Promise<unknown> =>
    json(
      (await run({
        command: 'gh',
        cwd,
        args: [
          'api',
          '--hostname',
          'github.com',
          '--method',
          method,
          path,
          ...(body === undefined ? [] : ['--input', '-']),
        ],
        ...(body === undefined ? {} : { input: JSON.stringify(body) }),
      })) || 'null',
    );
}

export function azureApi(run: RunCli, cwd: string, repository: PullRequestRepository) {
  return async (
    resource: string,
    route: Record<string, string | number> = {},
    query: Record<string, string | number> = {},
    method = 'GET',
    body?: unknown,
    area = 'git',
  ): Promise<unknown> => {
    let directory: string | undefined;
    try {
      const routes =
        area === 'location'
          ? route
          : {
              project: repository.project!,
              ...(area === 'git' ? { repositoryId: repository.name } : {}),
              ...route,
            };
      const args = [
        'devops',
        'invoke',
        '--organization',
        `https://dev.azure.com/${repository.owner}`,
        '--area',
        area,
        '--resource',
        resource,
        '--api-version',
        // az devops invoke parses the version as a float after removing '-preview'.
        // Its SDK negotiates the resource revision; a '.1' suffix fails before any request.
        area === 'git' ? '7.1' : '7.1-preview',
        '--http-method',
        method,
        '--only-show-errors',
        '--output',
        'json',
      ];
      if (Object.keys(routes).length)
        args.push('--route-parameters', ...Object.entries(routes).map(([k, v]) => `${k}=${v}`));
      if (Object.keys(query).length)
        args.push('--query-parameters', ...Object.entries(query).map(([k, v]) => `${k}=${v}`));
      if (body !== undefined) {
        directory = await mkdtemp(join(tmpdir(), 'prokop-pr-'));
        const file = join(directory, 'body.json');
        await writeFile(file, JSON.stringify(body), { mode: 0o600 });
        args.push('--in-file', file);
      }
      return json((await run({ command: 'az', cwd, args })) || 'null');
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  };
}
