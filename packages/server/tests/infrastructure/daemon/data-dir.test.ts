import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startDaemon } from '@/infrastructure/daemon';
import { Paths } from '@/infrastructure/runtime/paths';

const envKeys = ['PROKOPAI_DATA_DIR', 'JEAN2_DATA_DIR', 'DAEMON_TEST_SECRET'] as const;

describe('daemon data-directory isolation', () => {
  let root: string;
  let savedEnv: Array<string | undefined>;
  let savedArgv: string[];
  let spawn: ReturnType<typeof spyOn<typeof Bun, 'spawn'>>;

  beforeEach(() => {
    savedEnv = envKeys.map((key) => process.env[key]);
    savedArgv = [...process.argv];
    root = mkdtempSync(join(tmpdir(), 'prokop-daemon-test-'));
    Paths.reset();
    for (const key of envKeys) delete process.env[key];
    process.env.DAEMON_TEST_SECRET = 'must-not-reach-child';
    // Never launch a real server. A zero PID exits before PID-file writes.
    spawn = spyOn(Bun, 'spawn').mockImplementation(() => ({ pid: 0 }) as ReturnType<typeof Bun.spawn>);
  });

  afterEach(() => {
    spawn.mockRestore();
    process.argv = savedArgv;
    Paths.reset();
    envKeys.forEach((key, index) => {
      const value = savedEnv[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    rmSync(root, { recursive: true, force: true });
  });

  for (const launch of ['compiled', 'source'] as const) {
    for (const selection of ['canonical', 'legacy', 'conflicting', 'programmatic'] as const) {
      test(`${launch} launch preserves ${selection} data root`, async () => {
        process.argv[1] = launch === 'compiled' ? '/fake/prokop' : '/fake/cli.ts';
        if (selection === 'legacy') {
          process.env.JEAN2_DATA_DIR = root;
        } else {
          process.env.PROKOPAI_DATA_DIR = root;
        }
        if (selection === 'conflicting') {
          process.env.JEAN2_DATA_DIR = join(root, 'wrong-legacy-root');
        }
        if (selection === 'programmatic') {
          process.env.PROKOPAI_DATA_DIR = join(root, 'wrong-env-root');
          Paths.configure({ dataDir: root });
        }

        await startDaemon({ port: 8842, host: '127.0.0.1' });

        expect(spawn).toHaveBeenCalledTimes(1);
        const [command, options] = spawn.mock.calls[0] as unknown as [string[], { env: NodeJS.ProcessEnv }];
        expect(command).toContain(launch === 'compiled' ? process.execPath : 'bun');
        expect(options.env).toMatchObject({
          PROKOPAI_DATA_DIR: root,
          JEAN2_DATA_DIR: root,
          PROKOPAI_PORT: '8842',
          JEAN2_PORT: '8842',
          PROKOPAI_HOST: '127.0.0.1',
          JEAN2_HOST: '127.0.0.1',
        });
        expect(options.env.DAEMON_TEST_SECRET).toBeUndefined();
      });
    }
  }
});
