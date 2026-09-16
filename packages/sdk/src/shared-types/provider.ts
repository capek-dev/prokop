import type { ProviderStatus } from '@capekai/types/provider';

export type * from '@capekai/types/provider';

/** Safe subscription metadata. Credential fields stay on the server. */
export interface ProviderAccountSummary {
  id: string;
  label: string;
  connectedAt: string;
  connectionId: string;
  reauthRequired: boolean;
}

export interface ProviderAccountStatus extends ProviderStatus {
  accounts?: ProviderAccountSummary[];
  activeAccountId?: string | null;
}
