import { homedir } from 'node:os';
import type { PullRequestRepository } from '@prokopai/sdk/types';
import { BadRequestError, ConflictError } from '@/application/http-errors';
import { array, json, object, str, type RunCli } from './cli';

/** Microsoft Entra resource ID of Azure DevOps; its tokens authorize dev.azure.com REST calls. */
const DEVOPS_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';
const NO_TENANT = '00000000-0000-0000-0000-000000000000';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 8 * 1024 * 1024;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A failure the user fixes on the server; `command` is shown verbatim in the UI. */
export class AzureSetupError extends BadRequestError {
  constructor(message: string, command: string) {
    super(message, { command });
  }
}

export interface AzureCredentials {
  authorization(organization: string): Promise<string>;
  /** Drop cached tokens after Azure rejects them. */
  invalidate(organization: string): void;
  signInCommand(organization: string): string;
}

/**
 * `az devops invoke` only uses the default az tenant, so organizations backed by
 * another Microsoft Entra tenant reject it ("identity has not been materialized").
 * Resolve each organization's tenant and mint a token for that tenant instead.
 */
export function createAzureCredentials(
  run: RunCli,
  fetcher: FetchLike,
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): AzureCredentials {
  const tenants = new Map<string, string | null>();
  const tokens = new Map<string, Promise<{ value: string; expires: number }>>();
  const command = (tenant: string | null | undefined) =>
    tenant ? `az login --tenant ${tenant} --allow-no-subscriptions` : 'az login';

  const tenantOf = async (organization: string): Promise<string | null> => {
    if (tenants.has(organization)) return tenants.get(organization)!;
    let response: Response;
    try {
      // Unauthenticated; Azure names the owning tenant in a response header.
      response = await fetcher(`https://dev.azure.com/${organization}/_apis/connectionData`, {
        method: 'HEAD',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BadRequestError('Could not reach Azure DevOps from the Prokop server.');
    }
    const header = response.headers.get('x-vss-resourcetenant');
    const tenant = header && GUID.test(header) && header !== NO_TENANT ? header.toLowerCase() : null;
    tenants.set(organization, tenant);
    return tenant;
  };

  const az = (args: string[], classify?: (stderr: string) => string | undefined) =>
    run({ command: 'az', cwd: homedir(), args: [...args, '--only-show-errors', '--output', 'json'], classify });

  const mint = async (organization: string) => {
    const tenant = await tenantOf(organization);
    let signIn = false;
    const classify = (stderr: string) => {
      const message = /AADSTS50020|AADSTS90072|does not exist in tenant/i.test(stderr)
        ? `The Azure CLI account is not a member of the Microsoft Entra tenant that owns "${organization}". Sign in with an account from that tenant, then rescan.`
        : /AADSTS|az login|interaction|expired|refresh token|no subscription|not logged/i.test(stderr)
          ? `Azure CLI needs a sign-in for the tenant that owns "${organization}". Run the command below on the Prokop server, then rescan.`
          : undefined;
      signIn ||= message !== undefined;
      return message;
    };
    try {
      let target: string[] = [];
      if (tenant) {
        // Prefer an account already signed in to this tenant over the default account.
        const accounts = array(json(await az(['account', 'list', '--all'], classify))).map(object);
        const match =
          accounts.find((a) => str(a.tenantId).toLowerCase() === tenant && a.isDefault === true) ??
          accounts.find((a) => str(a.tenantId).toLowerCase() === tenant);
        target = match && str(match.id) ? ['--subscription', str(match.id)] : ['--tenant', tenant];
      }
      const token = object(
        json(await az(['account', 'get-access-token', '--resource', DEVOPS_RESOURCE, ...target], classify)),
      );
      const value = str(token.accessToken);
      if (!value) throw new BadRequestError('Azure CLI returned no access token.');
      const expires =
        typeof token.expires_on === 'number'
          ? token.expires_on * 1000
          : Date.parse(str(token.expiresOn)) || now() + 30 * 60_000;
      return { value: `Bearer ${value}`, expires };
    } catch (error: unknown) {
      if (signIn && error instanceof BadRequestError) throw new AzureSetupError(error.message, command(tenant));
      throw error;
    }
  };

  const authorization = async (organization: string): Promise<string> => {
    const pat = env.AZURE_DEVOPS_EXT_PAT;
    if (pat) return `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    const cached = tokens.get(organization);
    if (cached) {
      const token = await cached;
      if (token.expires - now() > 5 * 60_000) return token.value;
      if (tokens.get(organization) === cached) tokens.delete(organization);
    }
    let pending = tokens.get(organization);
    if (!pending) {
      const minted = mint(organization);
      pending = minted;
      tokens.set(organization, minted);
      // A failed sign-in must not stick; the next request runs az again.
      minted.catch(() => {
        if (tokens.get(organization) === minted) tokens.delete(organization);
      });
    }
    return (await pending).value;
  };

  return {
    authorization,
    invalidate(organization) {
      tokens.delete(organization);
      tenants.delete(organization);
    },
    signInCommand(organization) {
      return env.AZURE_DEVOPS_EXT_PAT ? 'export AZURE_DEVOPS_EXT_PAT=<new token>' : command(tenants.get(organization));
    },
  };
}

export interface AzureRequest {
  /** Path below the scope's `_apis/` base, without a leading slash. */
  path: string;
  scope?: 'repository' | 'project' | 'organization' | 'identities';
  query?: Record<string, string | number>;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  version?: string;
}
export type AzureApi = (request: AzureRequest) => Promise<unknown>;

/** Azure's own error text is safe and actionable (for example TF401179); keep it bounded. */
function azureMessage(text: string): string {
  try {
    const message = [...str(object(JSON.parse(text)).message)]
      .map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
      .join('')
      .trim();
    return message.length > 300 ? `${message.slice(0, 300)}…` : message;
  } catch {
    return '';
  }
}

export function azureRest(
  fetcher: FetchLike,
  credentials: AzureCredentials,
  repository: PullRequestRepository,
): AzureApi {
  const org = repository.owner;
  const project = `https://dev.azure.com/${org}/${encodeURIComponent(repository.project!)}/_apis/`;
  const bases = {
    organization: `https://dev.azure.com/${org}/_apis/`,
    project,
    repository: `${project}git/repositories/${encodeURIComponent(repository.name)}/`,
    identities: `https://vssps.dev.azure.com/${org}/_apis/`,
  };
  const signIn = (message: string) => new AzureSetupError(message, credentials.signInCommand(org));
  return async ({ path, scope = 'repository', query = {}, method = 'GET', body, version = '7.1' }) => {
    const url = new URL(path, bases[scope]);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    url.searchParams.set('api-version', version);
    let response: Response;
    let text: string;
    try {
      response = await fetcher(url.href, {
        method,
        headers: {
          authorization: await credentials.authorization(org),
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Unauthenticated requests redirect to an HTML sign-in page.
        redirect: 'manual',
        signal: AbortSignal.timeout(60_000),
      });
      if (Number(response.headers.get('content-length')) > MAX_BYTES)
        throw new BadRequestError('Provider response exceeded the size limit. Open this request on Azure DevOps.');
      text = await response.text();
    } catch (error: unknown) {
      if (error instanceof BadRequestError) throw error;
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
        throw new BadRequestError(
          'Azure DevOps timed out. Refresh the PR before retrying; the remote action may have completed.',
        );
      throw new BadRequestError('Could not reach Azure DevOps from the Prokop server.');
    }
    if (text.length > MAX_BYTES)
      throw new BadRequestError('Provider response exceeded the size limit. Open this request on Azure DevOps.');
    const status = response.status;
    const html = !/json/i.test(response.headers.get('content-type') ?? '') && text.trim() !== '';
    if (status === 401 || status === 203 || (status >= 300 && status < 400) || (status < 300 && html)) {
      credentials.invalidate(org);
      throw signIn(`Azure DevOps rejected the server's sign-in for "${org}". Sign in again, then rescan.`);
    }
    if (status === 429) throw new BadRequestError('Provider rate limit reached. Wait before refreshing.');
    if (status >= 400) {
      const detail = azureMessage(text);
      if (status === 409 || status === 412) throw new ConflictError(detail || 'The PR changed. Refresh before continuing.');
      if (/has not been materialized/i.test(detail))
        throw signIn(`Your Azure CLI identity is not a member of "${org}". Sign in with an account that has access.`);
      throw new BadRequestError(
        detail ||
          (status === 403
            ? 'Azure DevOps refused this operation. Check your permissions and repository policies.'
            : status === 404
              ? 'Azure DevOps could not find this resource, or you do not have access to it.'
              : `Azure DevOps request failed (HTTP ${status}). Refresh before retrying a write.`),
      );
    }
    return text.trim() ? json(text) : null;
  };
}
