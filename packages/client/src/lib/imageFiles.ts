/**
 * The server's image preview list (`binary-detection.ts`) minus SVG, which
 * is text and opens in the editor like any other source file.
 */
const BINARY_IMAGE_EXTENSIONS = new Set([
  'png', 'apng', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur', 'tif', 'tiff', 'heic', 'heif',
]);

/** Binary images can only be previewed, so the tree opens them in preview whatever the default mode. */
export function isBinaryImagePath(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && BINARY_IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
