// Pairing links for addresses other devices use to reach this server
/** The code travels in the fragment so it never reaches server or proxy logs. */
export function buildPairingUrl(baseUrl: string, code: string): string {
  const url = new URL(baseUrl);
  url.pathname = '/pair';
  url.hash = new URLSearchParams([['code', code]]).toString();
  return url.toString();
}
