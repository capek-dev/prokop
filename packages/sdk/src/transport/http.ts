import { ApiError, AuthError, ConnectionError, RateLimitError, ServerError, ValidationError } from '../errors';

export interface HttpClientConfig {
  url: string;
  token?: string;
  apiBase?: string;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  params?: Record<string, string>;
}

export class HttpClient {
  private baseUrl: string;
  private token: string | undefined;

  constructor(config: HttpClientConfig) {
    const apiBase = config.apiBase || '/api';
    const proto = config.url.startsWith('https') ? 'https' : 'http';
    const clean = config.url.replace(/^https?:\/\//, '');
    this.baseUrl = `${proto}://${clean}${apiBase}`;
    this.token = config.token;
  }

  async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const {
      method = 'GET',
      body,
      headers = {},
      signal,
      params,
    } = options;

    let url = `${this.baseUrl}${path}`;

    if (params) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }

    const requestHeaders: Record<string, string> = { ...headers };

    if (body !== undefined && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    if (this.token) {
      requestHeaders['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (response.status === 401) {
      throw new AuthError('Authentication failed. Your token may be invalid or expired.');
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retryAfterMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined;
      throw new RateLimitError('Too many requests', retryAfterMs);
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      let errorCode: string | undefined;
      let errorDetails: unknown;
      let parsed = false;
      try {
        const errorBody = await response.json() as { error?: string; message?: string; details?: unknown };
        if (errorBody.message) errorMessage = errorBody.message;
        if (errorBody.error) errorCode = errorBody.error;
        if (errorBody.details !== undefined) errorDetails = errorBody.details;
        parsed = true;
      } catch {
        // Ignore parse error for error body
      }

      if (parsed && errorCode) {
        throw new ApiError(errorMessage, response.status, errorCode, { details: errorDetails });
      }

      if (response.status >= 500) {
        throw new ServerError(errorMessage, response.status);
      }
      throw new ValidationError(errorMessage, response.status);
    }

    const contentType = response.headers.get('Content-Type');
    if (contentType?.includes('application/json')) {
      return response.json() as Promise<T>;
    }

    return response as unknown as T;
  }

  get<T>(path: string, options?: { params?: Record<string, string>; signal?: AbortSignal }): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  patch<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  delete<T>(path: string, options?: { signal?: AbortSignal }): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * Verify that a token is valid against a server.
   * Makes a lightweight GET /api/auth/verify request.
   * Useful as a pre-flight check before opening a WebSocket connection.
   *
   * @returns true if token is valid (200), false if invalid (401)
   * @throws ConnectionError on timeout, cancellation, or a response other than 200/401
   */
  static async verifyToken(
    url: string,
    token?: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<boolean> {
    const proto = url.startsWith('https') ? 'https' : 'http';
    const clean = url.replace(/^https?:\/\//, '');
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      // Bun's RequestInit omits the browser cache option.
      const requestOptions = { headers, signal: controller.signal, cache: 'no-store' as const };
      const response = await fetch(`${proto}://${clean}/api/auth/verify`, requestOptions);
      if (response.status === 401) return false;
      if (response.status !== 200) {
        throw new ConnectionError(`Auth verification unavailable (HTTP ${response.status})`);
      }
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ConnectionError(`Failed to reach server for auth verification: ${message}`);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  }
}
