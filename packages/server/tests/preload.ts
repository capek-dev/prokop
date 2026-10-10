import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import defaultModelsJson from '@/config/models.json';

// Tests must never open the user's real data root (~/.prokopai). A test that
// reaches getDatabase() without an override would otherwise write to the live
// server's agent.db and can lock it mid-turn. Seed the temporary root the way
// `prokop init` does so config and model lookups still resolve.
const dataDir = mkdtempSync(join(tmpdir(), 'prokopai-test-'));
writeFileSync(join(dataDir, 'config.json'), '{}');
writeFileSync(join(dataDir, 'models.json'), JSON.stringify(defaultModelsJson, null, 2));
process.env.PROKOPAI_DATA_DIR = dataDir;
delete process.env.JEAN2_DATA_DIR;
delete process.env.PROKOPAI_DATABASE_PATH;
delete process.env.JEAN2_DATABASE_PATH;
