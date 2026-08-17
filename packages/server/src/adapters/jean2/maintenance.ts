import {
  cleanupOrphanedData,
  vacuumDatabase,
} from '@/infrastructure/sqlite/cleanup';
import type { MaintenanceApplication } from '@/application/ports/maintenance';

export function createJean2MaintenanceApplication(): MaintenanceApplication {
  return {
    cleanup: cleanupOrphanedData,
    vacuum: vacuumDatabase,
  };
}
