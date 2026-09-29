import type { MaintenanceApplication } from '@/application/ports/maintenance';

export function createMaintenanceApplication(
  maintenance: MaintenanceApplication,
): MaintenanceApplication {
  return maintenance;
}
