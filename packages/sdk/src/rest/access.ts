import type { HttpClient } from '../transport/http';
import type { AccessStatus, PairedDevice, PendingAccessRequest } from '../pairing';

export interface AccessOverviewResponse {
  requests: PendingAccessRequest[];
  devices: PairedDevice[];
}

export interface CreatePairingCodeResponse {
  code: string;
  expiresAt: number;
  /** `/pair#code=...` links another device can open; empty when the server only listens on its own machine. */
  links: string[];
}

/** Device access management. Listing, approving, and creating codes require the server's own machine. */
export class AccessRestNamespace {
  constructor(private http: HttpClient) {}

  status(options?: { signal?: AbortSignal }): Promise<AccessStatus> {
    return this.http.get('/auth/status', { signal: options?.signal });
  }

  overview(options?: { signal?: AbortSignal }): Promise<AccessOverviewResponse> {
    return this.http.get('/auth/access', { signal: options?.signal });
  }

  approve(requestId: string): Promise<{ success: true }> {
    return this.http.post(`/auth/requests/${encodeURIComponent(requestId)}/approve`);
  }

  deny(requestId: string): Promise<{ success: true }> {
    return this.http.post(`/auth/requests/${encodeURIComponent(requestId)}/deny`);
  }

  revokeDevice(deviceId: string): Promise<{ success: true }> {
    return this.http.delete(`/auth/devices/${encodeURIComponent(deviceId)}`);
  }

  createPairingCode(label?: string): Promise<CreatePairingCodeResponse> {
    return this.http.post('/auth/pairing-codes', label ? { label } : {});
  }
}
