// packages/client/src/config/auth.ts

import { STORAGE_KEYS } from '@/lib/storage';

const TOKEN_KEY = STORAGE_KEYS.API_TOKEN;
const TOKEN_EXPIRY_KEY = STORAGE_KEYS.TOKEN_EXPIRY;
const SERVER_URL_KEY = STORAGE_KEYS.SERVER_URL;

/**
 * Get stored API token from localStorage
 * Returns null if not found or expired
 */
export function getStoredToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    
    if (!token) {
      return null;
    }
    
    // Check if token has expired
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (expiry && new Date(expiry) < new Date()) {
      clearStoredToken();
      return null;
    }
    
    return token;
  } catch (error) {
    console.error('Error reading token from localStorage:', error);
    return null;
  }
}

/**
 * Store API token in localStorage
 * @param token - API token to store
 * @param expiryDays - Optional expiry in days (default: 30)
 */
export function setStoredToken(token: string, expiryDays: number = 30): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    
    // Set expiry date
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + expiryDays);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiry.toISOString());
  } catch (error) {
    console.error('Error storing token in localStorage:', error);
  }
}

/**
 * Clear stored token from localStorage
 */
export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(SERVER_URL_KEY);
  } catch (error) {
    console.error('Error clearing token from localStorage:', error);
  }
}

/**
 * Get stored server URL from localStorage
 */
export function getStoredServerUrl(): string | null {
  try {
    return localStorage.getItem(SERVER_URL_KEY);
  } catch (error) {
    console.error('Error reading server URL from localStorage:', error);
    return null;
  }
}

/**
 * Store server URL in localStorage
 */
export function setStoredServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_URL_KEY, url);
  } catch (error) {
    console.error('Error storing server URL in localStorage:', error);
  }
}

/**
 * Clear stored server URL from localStorage
 */
export function clearStoredServerUrl(): void {
  try {
    localStorage.removeItem(SERVER_URL_KEY);
  } catch (error) {
    console.error('Error clearing server URL from localStorage:', error);
  }
}

/**
 * Check if token is stored
 */
export function hasStoredToken(): boolean {
  return getStoredToken() !== null;
}

/**
 * Check if a token value is non-empty
 * The server accepts any non-empty string via JEAN2_AUTH_TOKEN
 */
export function isValidTokenFormat(token: string): boolean {
  return token.trim().length > 0;
}

/**
 * Mask token for display (show first/last 4 chars)
 * Example: abc123...def456
 */
export function maskToken(token: string): string {
  if (token.length < 12) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

/**
 * Normalize server URL by stripping protocol prefixes and trailing slashes.
 * Preserves https:// prefix to allow secure protocol detection.
 * @param url - Raw URL input from user
 * @returns Clean host:port or host format, with https:// preserved if originally present
 *
 * Examples:
 *   - "http://localhost:3000/" → "localhost:3000"
 *   - "https://domain/" → "https://domain"
 *   - "https://domain:8080" → "https://domain:8080"
 *   - "domain:8080/" → "domain:8080"
 */
export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim();
  const isHttps = /^https:\/\//i.test(trimmed);

  let normalized = trimmed.replace(/^(https?:\/\/|wss?:\/\/)/i, '');
  normalized = normalized.replace(/\/+$/, '');

  if (isHttps) {
    normalized = `https://${normalized}`;
  }

  return normalized;
}
