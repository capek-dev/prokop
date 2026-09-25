import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Development preview only. Do not ship this pair as a signed macOS application.
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Local native build currently supports macOS arm64 only');
}
const root = resolve(import.meta.dir, '../..');
function run(command: string[]): void {
  const result = Bun.spawnSync(command, { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (result.exitCode !== 0) throw new Error(`${command[0]} exited with code ${result.exitCode}`);
}
run(['bun', 'run', 'build:bin:macos']);
run(['cargo', 'build', '--locked', '--release', '--manifest-path', 'apps/desktop/Cargo.toml']);
const host = join(root, 'packages/server/dist/bin/prokop-macos-arm64');
const destination = join(root, 'apps/desktop/target/release/prokop');
if (!existsSync(host)) throw new Error('Compiled host binary is missing');
if (!existsSync(join(root, 'apps/desktop/target/release/prokop-desktop'))) {
  throw new Error('Compiled desktop binary is missing');
}
// Bun's compiled arm64 output can carry an invalid linker signature. macOS
// kills that executable before its CLI starts, so verify both the signature
// and the harmless version command before copying it beside the desktop.
run(['codesign', '--force', '--sign', '-', host]);
run(['codesign', '--verify', '--verbose=2', host]);
run([host, 'version']);
copyFileSync(host, destination);
chmodSync(destination, 0o755);
run(['codesign', '--verify', '--verbose=2', destination]);
console.log(`Local preview binaries: ${join(root, 'apps/desktop/target/release')}`);
