// =============================================================================
// Prokop Browser Build Script
//
// Bundles the browser extension for loading in Chrome.
// Output: dist/ directory containing manifest.json + bundled JS files.
//
// Usage:
//   bun run build          # development build
//   bun run build:prod     # production (minified)
// =============================================================================

import { existsSync } from 'fs';
import { mkdirSync, rmSync, copyFileSync, cpSync } from 'fs';

const isProd = process.argv.includes('--production');
const outDir = 'dist';

// Clean previous build
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true });
}
mkdirSync(outDir, { exists: false });

// Bundle entry points
const entryPoints = ['src/background.ts', 'src/content.ts', 'src/popup.ts'];

const result = await Bun.build({
  entrypoints: entryPoints,
  outdir: outDir,
  target: 'browser',
  minify: isProd,
  sourcemap: isProd ? 'none' : 'linked',
  naming: '[name].[ext]',
});

if (!result.success) {
  console.error('Build failed:');
  for (const log of result.logs) {
    console.error(' ', log.message);
  }
  process.exit(1);
}

// Copy manifest to dist (with updated paths)
const manifest = await Bun.file('manifest.json').json();
manifest.background.service_worker = 'background.js';
manifest.content_scripts[0].js = ['content.js'];

// Remove the "type": "module" since bun bundles into self-contained files
delete manifest.background.type;

await Bun.write(
  `${outDir}/manifest.json`,
  JSON.stringify(manifest, null, 2),
);

// Copy popup HTML
copyFileSync('popup.html', `${outDir}/popup.html`);

// Copy icons directory
cpSync('icons', `${outDir}/icons`, { recursive: true });

// Summary
for (const artifact of result.outputs) {
  const kb = (artifact.size / 1024).toFixed(1);
  console.log(`  ${artifact.path} (${kb} KB)`);
}
console.log(`\n✓ Extension built to ${outDir}/`);
console.log('  Load as unpacked extension: chrome://extensions → Developer mode → Load unpacked → select dist/');
