import {
  cleanupOrphanedData,
  vacuumDatabase,
} from '@/infrastructure/sqlite/cleanup';
import type { MaintenanceApplication } from '@/application/ports/maintenance';

export function createProkopMaintenanceApplication(): MaintenanceApplication {
  return {
    cleanup: cleanupOrphanedData,
    vacuum: vacuumDatabase,
  };
}
