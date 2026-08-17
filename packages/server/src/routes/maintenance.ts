import type { Hono } from 'hono';
import type { MaintenanceApplication } from '@/application/ports/maintenance';

export function registerMaintenanceRoutes(app: Hono, maintenance: MaintenanceApplication): void {
  // GET /api/maintenance/db-stats - Database size and page statistics
  app.get('/api/maintenance/db-stats', (c) => {
    try {
      const result = maintenance.vacuum({ dryRun: true });
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'Database stats failed', message }, 500);
    }
  });

  // POST /api/maintenance/vacuum - Reclaim free space in the database
  app.post('/api/maintenance/vacuum', (c) => {
    try {
      const result = maintenance.vacuum();
      return c.json({ success: true, ...result });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'Vacuum failed', message }, 500);
    }
  });

  // POST /api/maintenance/cleanup - Remove orphaned data
  app.post('/api/maintenance/cleanup', (c) => {
    try {
      const stats = maintenance.cleanup();
      return c.json({ success: true, stats });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: 'Cleanup failed', message }, 500);
    }
  });
}
