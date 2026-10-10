const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function createSlug(length = 7, random = Math.random): string {
  let slug = '';
  for (let i = 0; i < length; i += 1) {
    slug += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return slug;
}

export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
