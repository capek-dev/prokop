const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.ico',
  '.zip',
  '.gz',
  '.tar',
  '.bz2',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.obj',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.pyo',
  '.o',
  '.a',
  '.lib',
  '.dmg',
  '.iso',
  '.img',
  '.apk',
  '.ipa',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.mkv',
  '.webm',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.sqlite',
  '.db',
  '.db3',
]);

export const FILE_PREVIEW_MAX_BYTES = 1_048_576;
export const FILE_PREVIEW_BINARY_SNIFF_BYTES = 4096;

export function isBinaryExtension(ext: string | undefined): boolean {
  if (!ext) return false;
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

export function isBinaryBuffer(buffer: Uint8Array): boolean {
  if (buffer.length === 0) return false;

  const sniff = buffer.subarray(0, FILE_PREVIEW_BINARY_SNIFF_BYTES);
  let nonPrintableCount = 0;

  for (const byte of sniff) {
    if (byte === 0x00) return true;

    const isPrintable =
      (byte >= 0x20 && byte <= 0x7e) ||
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d;

    if (!isPrintable) {
      nonPrintableCount++;
    }
  }

  return nonPrintableCount / sniff.length > 0.3;
}

export async function isBinaryFile(
  filePath: string,
  fileSize: number,
): Promise<boolean> {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (isBinaryExtension(ext)) {
    return true;
  }

  if (fileSize === 0) {
    return false;
  }

  const file = Bun.file(filePath);
  const bytesToRead = Math.min(FILE_PREVIEW_BINARY_SNIFF_BYTES, fileSize);
  const buffer = Buffer.from(await file.slice(0, bytesToRead).arrayBuffer());
  return isBinaryBuffer(buffer);
}
