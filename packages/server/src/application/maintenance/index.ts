import type { MaintenanceApplication } from '../ports/maintenance';

export function createMaintenanceApplication(
  maintenance: MaintenanceApplication,
): MaintenanceApplication {
  return maintenance;
}
