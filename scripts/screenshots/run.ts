/**
 * bun run screenshots [--scene <name>]... [--theme <filter>]... [--out <dir>] [--port <n>] [--home <dir>] [--keep]
 *
 * Boots an isolated sandbox instance (never the production one), builds the
 * demo world once, and captures every scene in every selected theme as
 * `<scene>.<mode>-<scheme>.png`.
 *
 * --theme accepts a mode (`dark`), a scheme (`ocean`), or both (`dark-ocean`).
 * Default: all 10 themes.
 *
 * --home sets the fake home the demo runs in; paths in the UI show it.
 * Default: ~/prokop-demo, created when missing. An existing directory is used
 * only when empty or created by an earlier run (then it is cleared).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { REPO_ROOT, startInstance } from './instance';
import { capture, lastPage, THEMES, themeName, type Scene, type SceneContext } from './scene';
import { branches } from './scenes/branches';
import { commandApproval } from './scenes/command-approval';
import { explorer } from './scenes/explorer';
import { fullWorkspace } from './scenes/full-workspace';
import { gitWorkbench } from './scenes/git-workbench';
import { hero } from './scenes/hero';
import { mobile } from './scenes/mobile';
import { multiSession } from './scenes/multi-session';
import { terminal } from './scenes/terminal';
import { worktrees } from './scenes/worktrees';
import { Demo } from './script';
import { buildWorld } from './world';

const SCENES: Scene[] = [hero, mobile, multiSession, gitWorkbench, commandApproval, explorer, branches, worktrees, terminal, fullWorkspace];

const { values } = parseArgs({
  options: {
    scene: { type: 'string', multiple: true },
    theme: { type: 'string', multiple: true },
    out: { type: 'string', default: join(import.meta.dir, 'out') },
    port: { type: 'string', default: '18742' },
    home: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});

const scenes = values.scene?.length ? SCENES.filter((scene) => values.scene!.includes(scene.name)) : SCENES;
if (scenes.length === 0) {
  console.error(`Unknown scene. Available: ${SCENES.map((scene) => scene.name).join(', ')}`);
  process.exit(1);
}

const themes = values.theme?.length
  ? THEMES.filter((theme) => values.theme!.some((filter) => [theme.mode, theme.scheme, themeName(theme)].includes(filter)))
  : THEMES;
if (themes.length === 0) {
  console.error(`Unknown theme. Available: ${THEMES.map(themeName).join(', ')}`);
  process.exit(1);
}

const clientIndex = Bun.file(join(REPO_ROOT, 'packages/client/dist/index.html'));
if (!(await clientIndex.exists())) {
  console.error('Client build missing. Run: cd packages/client && VITE_BASE=/ bun run build');
  process.exit(1);
}

mkdirSync(values.out, { recursive: true });
const instance = await startInstance(Number(values.port), values.home);
console.log(`Screenshot instance ${instance.url} (home: ${instance.home})`);

const shutdown = async () => {
  await instance.stop();
  process.exit(130);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const demo = new Demo(instance.url);
const browser = await chromium.launch({ channel: 'chrome' });
let failed = false;
try {
  await demo.connect();
  process.stdout.write('Building demo world ... ');
  const world = await buildWorld(demo, instance.home);
  // The connection that sent the turns holds session control; release it so
  // the captured client is not shown as a read-only viewer.
  await demo.disconnect();
  console.log('ok');
  const ctx: SceneContext = { instance, browser, world };

  for (const scene of scenes) {
    for (const theme of themes) {
      const name = `${scene.name}.${themeName(theme)}`;
      process.stdout.write(`${name} ... `);
      const page = await scene.open(ctx, theme).catch(async (error: unknown) => {
        const failedPage = lastPage();
        if (failedPage && !failedPage.isClosed()) {
          await failedPage.screenshot({ path: join(values.out, `${name}.failed.png`) });
          console.error(`Saved ${name}.failed.png`);
        }
        throw error;
      });
      await capture(page, values.out, name);
      await page.context().close();
      console.log('ok');
    }
  }
  console.log(`Saved ${scenes.length * themes.length} images to ${values.out}`);
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await browser.close();
  await demo.disconnect().catch(() => undefined);
  if (values.keep) {
    console.log(`--keep: instance still running at ${instance.url}. Ctrl-C to stop.`);
  } else {
    await instance.stop();
  }
}
if (failed) process.exit(1);
