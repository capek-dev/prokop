import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import type { ArboristNode } from '@npmcli/arborist';
import {
  getMinAgeHours,
  isJean2OwnedPackage,
  resetInstallState,
  resolveMaxSatisfying,
  extractIntegrity,
  checkVersionAge,
} from '@/infrastructure/tools/npm-utils';

function createTempDir(): string {
  return join(tmpdir(), `jean2-test-npm-utils-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

describe('npm-utils', () => {
  describe('getMinAgeHours', () => {
    afterEach(() => {
      delete process.env.JEAN2_PACKAGE_MIN_AGE_HOURS;
    });

    test('defaults to 24 when env var is not set', () => {
      expect(getMinAgeHours()).toBe(24);
    });

    test('parses numeric value', () => {
      process.env.JEAN2_PACKAGE_MIN_AGE_HOURS = '48';
      expect(getMinAgeHours()).toBe(48);
    });

    test('returns 0 when explicitly disabled with "0"', () => {
      process.env.JEAN2_PACKAGE_MIN_AGE_HOURS = '0';
      expect(getMinAgeHours()).toBe(0);
    });

    test('returns 0 when disabled with "false"', () => {
      process.env.JEAN2_PACKAGE_MIN_AGE_HOURS = 'false';
      expect(getMinAgeHours()).toBe(0);
    });

    test('returns 0 when disabled with "off"', () => {
      process.env.JEAN2_PACKAGE_MIN_AGE_HOURS = 'off';
      expect(getMinAgeHours()).toBe(0);
    });

    test('falls back to 24 on invalid value', () => {
      process.env.JEAN2_PACKAGE_MIN_AGE_HOURS = 'not-a-number';
      expect(getMinAgeHours()).toBe(24);
    });

    test('falls back to 24 on negative value', () => {
      process.env.JEAN2_PACKAGE_MIN_AGE_HOURS = '-5';
      expect(getMinAgeHours()).toBe(24);
    });
  });

  describe('isJean2OwnedPackage', () => {
    test('returns false for retired client packages', () => {
      expect(isJean2OwnedPackage('@jean2/client')).toBe(false);
      expect(isJean2OwnedPackage('@prokopai/client')).toBe(false);
    });

    test('returns true for @prokopai/sdk', () => {
      expect(isJean2OwnedPackage('@prokopai/sdk')).toBe(true);
    });

    test('returns false for unknown packages', () => {
      expect(isJean2OwnedPackage('lodash')).toBe(false);
      expect(isJean2OwnedPackage('@types/node')).toBe(false);
    });
  });

  describe('resetInstallState', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = createTempDir();
      mkdirSync(tempDir, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test('removes existing package-lock.json', () => {
      const lockfilePath = join(tempDir, 'package-lock.json');
      writeFileSync(lockfilePath, JSON.stringify({ lockfileVersion: 2 }));
      expect(existsSync(lockfilePath)).toBe(true);

      resetInstallState(tempDir);

      expect(existsSync(lockfilePath)).toBe(false);
    });

    test('removes existing node_modules', () => {
      const nodeModulesPath = join(tempDir, 'node_modules', 'some-pkg');
      mkdirSync(nodeModulesPath, { recursive: true });
      writeFileSync(join(nodeModulesPath, 'index.js'), 'module.exports = {};');
      expect(existsSync(join(tempDir, 'node_modules'))).toBe(true);

      resetInstallState(tempDir);

      expect(existsSync(join(tempDir, 'node_modules'))).toBe(false);
    });

    test('does nothing when neither lockfile nor node_modules exist', () => {
      resetInstallState(tempDir);
      expect(existsSync(join(tempDir, 'package-lock.json'))).toBe(false);
      expect(existsSync(join(tempDir, 'node_modules'))).toBe(false);
    });
  });

  describe('resolveMaxSatisfying', () => {
    const metadata = {
      distTags: { latest: '1.3.0' },
      time: {},
      versions: {
        '0.9.0': {},
        '0.9.3': {},
        '0.9.5': {},
        '1.0.0': {},
        '1.0.5': {},
        '1.1.0': {},
        '1.2.0': {},
        '1.3.0': {},
      },
    };

    test('resolves caret range', () => {
      expect(resolveMaxSatisfying(metadata, '^1.0.0')).toBe('1.3.0');
      expect(resolveMaxSatisfying(metadata, '^0.9.0')).toBe('0.9.5');
    });

    test('resolves exact version', () => {
      expect(resolveMaxSatisfying(metadata, '1.0.5')).toBe('1.0.5');
    });

    test('returns latest when range is "latest"', () => {
      expect(resolveMaxSatisfying(metadata, 'latest')).toBe('1.3.0');
    });

    test('returns null if no version satisfies range', () => {
      expect(resolveMaxSatisfying(metadata, '^2.0.0')).toBe(null);
    });
  });

  describe('extractIntegrity', () => {
    test('extracts integrity from tree node', () => {
      const tree = {
        path: '/project',
        children: new Map([['@prokopai/sdk', {
          path: '/project/node_modules/@prokopai/sdk',
          package: { dist: { integrity: 'sha512-abc123' } },
          children: new Map(),
        }]]),
      } as ArboristNode;

      expect(extractIntegrity(tree, '@prokopai/sdk')).toBe('sha512-abc123');
    });

    test('returns null when package not in tree', () => {
      const tree = { path: '/project', children: new Map() } as ArboristNode;
      expect(extractIntegrity(tree, '@prokopai/sdk')).toBe(null);
    });

    test('returns null when tree is null', () => {
      expect(extractIntegrity(null, '@prokopai/sdk')).toBe(null);
    });

    test('returns null when tree is undefined', () => {
      expect(extractIntegrity(undefined, '@prokopai/sdk')).toBe(null);
    });

    test('returns null when dist.integrity is missing', () => {
      const tree = {
        path: '/project',
        children: new Map([['@prokopai/sdk', {
          path: '/project/node_modules/@prokopai/sdk',
          package: { dist: {} },
          children: new Map(),
        }]]),
      } as ArboristNode;
      expect(extractIntegrity(tree, '@prokopai/sdk')).toBe(null);
    });
  });

  describe('checkVersionAge', () => {
    test('returns ok when min age is disabled (0)', async () => {
      process.env.JEAN2_PACKAGE_MIN_AGE_HOURS = '0';
      const result = await checkVersionAge('@jean2/client', '1.0.0');
      expect(result.ok).toBe(true);
      expect(result.minAgeHours).toBe(0);
      delete process.env.JEAN2_PACKAGE_MIN_AGE_HOURS;
    });
  });
});
