export interface Link {
  slug: string;
  url: string;
  createdAt: number;
  expiresAt: number | null;
  clicks: number;
}

export class LinkStore {
  private links = new Map<string, Link>();

  create(slug: string, url: string, ttlDays: number | null, now = Date.now()): Link {
    const link: Link = {
      slug,
      url,
      createdAt: now,
      expiresAt: ttlDays === null ? null : now + ttlDays * 24 * 60 * 60 * 1000,
      clicks: 0,
    };
    this.links.set(slug, link);
    return link;
  }

  get(slug: string): Link | undefined {
    return this.links.get(slug);
  }

  has(slug: string): boolean {
    return this.links.has(slug);
  }

  recordClick(slug: string): void {
    const link = this.links.get(slug);
    if (link) link.clicks += 1;
  }
}
