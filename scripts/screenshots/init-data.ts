/**
 * Initializes a fresh data dir. Run only as a child of instance.ts, which
 * sets PROKOPAI_DATA_DIR to the throwaway directory.
 */
import { initProkop } from '../../packages/server/src/cli/init';

if (!process.env.PROKOPAI_DATA_DIR) {
  console.error('init-data.ts requires PROKOPAI_DATA_DIR; refusing to touch the default data dir');
  process.exit(1);
}

const result = await initProkop({ runMigrations: true, installPreconfigs: true });
if (!result.success) {
  console.error(result.error);
  process.exit(1);
}
