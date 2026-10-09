import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { workspacePathPolicyPort } from '@/adapters/workspace-paths';
import { createFilePreview } from '@/infrastructure/filesystem/file-preview';
import { IMAGE_PREVIEW_MAX_BYTES } from '@/infrastructure/filesystem/binary-detection';

const getFilePreview = createFilePreview(workspacePathPolicyPort);
const roots: string[] = [];

function workspace(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), 'image-preview-'));
  roots.push(root);
  for (const [name, data] of Object.entries(files)) writeFileSync(join(root, name), data);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// The 8-byte PNG signature is enough: the preview never decodes the image.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';

describe('image file preview', () => {
  test.each([
    ['logo.png', 'image/png'],
    ['photo.JPG', 'image/jpeg'],
    ['favicon.ico', 'image/x-icon'],
    ['anim.gif', 'image/gif'],
    ['hero.webp', 'image/webp'],
    ['scan.avif', 'image/avif'],
  ])('%s previews as an image data URL', async (name, mimeType) => {
    const root = workspace({ [name]: PNG });
    const preview = await getFilePreview(root, name, []);

    expect(preview).toMatchObject({ kind: 'image', mimeType, size: PNG.length });
    expect(preview.kind === 'image' && preview.dataUrl).toBe(`data:${mimeType};base64,${Buffer.from(PNG).toString('base64')}`);
  });

  test('an SVG previews as an image and keeps its source for the Source view', async () => {
    const root = workspace({ 'icon.svg': SVG });
    const preview = await getFilePreview(root, 'icon.svg', []);

    expect(preview).toMatchObject({ kind: 'image', mimeType: 'image/svg+xml', content: SVG });
  });

  test('images above the image limit are reported as too large without being read', async () => {
    const root = workspace({ 'huge.png': new Uint8Array(IMAGE_PREVIEW_MAX_BYTES + 1) });
    const preview = await getFilePreview(root, 'huge.png', []);

    expect(preview).toMatchObject({ kind: 'too_large', maxBytes: IMAGE_PREVIEW_MAX_BYTES });
  });

  test('images between the text and image limits still preview', async () => {
    const root = workspace({ 'screenshot.png': new Uint8Array(2 * 1_048_576) });
    expect((await getFilePreview(root, 'screenshot.png', [])).kind).toBe('image');
  });

  test('other binary files are still refused', async () => {
    const root = workspace({ 'archive.zip': PNG });
    expect((await getFilePreview(root, 'archive.zip', [])).kind).toBe('binary');
  });
});
