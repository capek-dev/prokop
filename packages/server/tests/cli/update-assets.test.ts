import { describe, expect, test } from 'bun:test';
import { getDownloadUrl, getUpdateBinaryPath, usesLegacyAssetName } from '@/cli/update';

describe('server update asset names', () => {
  test('uses jean2 assets through the last published 1.4 release', () => {
    expect(usesLegacyAssetName('0.9.0')).toBe(true);
    expect(usesLegacyAssetName('1.4.0')).toBe(true);
    expect(getDownloadUrl('1.4.0', 'darwin').endsWith('/jean2-darwin')).toBe(true);
    expect(getDownloadUrl('1.4.0', 'windows').endsWith('/jean2-windows.exe')).toBe(true);
  });

  test('uses prokop assets starting with 1.5', () => {
    expect(usesLegacyAssetName('1.5.0')).toBe(false);
    expect(usesLegacyAssetName('2.0.0')).toBe(false);
    expect(getDownloadUrl('1.5.0', 'linux').endsWith('/prokop-linux')).toBe(true);
    expect(getDownloadUrl('1.5.0', 'windows').endsWith('/prokop-windows.exe')).toBe(true);
  });

  test('self-update replaces the released jean2 command name', () => {
    expect(getUpdateBinaryPath('/opt/jean2/bin/jean2', 'linux')).toBe('/opt/jean2/bin/prokop');
    expect(getUpdateBinaryPath('/opt/jean2/bin/jean2.exe', 'windows')).toBe('/opt/jean2/bin/prokop.exe');
  });
});
