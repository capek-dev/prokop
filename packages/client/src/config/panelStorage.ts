/**
 * Helper functions for panel width persistence
 */

import type { SavedPanelWidth } from '@prokopai/sdk';
import {
  PANEL_STORAGE_KEYS,
  PANEL_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  clampPanelWidth,
} from '@prokopai/sdk';

/**
 * Clamps a width value to valid panel bounds
 */
export function clampWidth(width: number): number {
  return clampPanelWidth(width);
}

/**
 * Read sessions panel width from localStorage
 * Returns default if not set or invalid
 */
export function getSessionsPanelWidth(defaultWidth: number): number {
  if (typeof window === 'undefined') return defaultWidth;
  try {
    const stored = localStorage.getItem(PANEL_STORAGE_KEYS.SESSIONS);
    if (stored === null) return defaultWidth;
    const parsed = JSON.parse(stored) as SavedPanelWidth;
    if (typeof parsed.width !== 'number' || isNaN(parsed.width)) {
      return defaultWidth;
    }
    return clampWidth(parsed.width);
  } catch {
    return defaultWidth;
  }
}

/**
 * Save sessions panel width to localStorage
 */
export function saveSessionsPanelWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clampedWidth = clampWidth(width);
    localStorage.setItem(
      PANEL_STORAGE_KEYS.SESSIONS,
      JSON.stringify({ width: clampedWidth } satisfies SavedPanelWidth),
    );
  } catch (error) {
    console.warn('Error saving sessions panel width:', error);
  }
}

/**
 * Read files panel width from localStorage
 * Returns default if not set or invalid
 */
export function getFilesPanelWidth(defaultWidth: number): number {
  if (typeof window === 'undefined') return defaultWidth;
  try {
    const stored = localStorage.getItem(PANEL_STORAGE_KEYS.FILES);
    if (stored === null) return defaultWidth;
    const parsed = JSON.parse(stored) as SavedPanelWidth;
    if (typeof parsed.width !== 'number' || isNaN(parsed.width)) {
      return defaultWidth;
    }
    return clampWidth(parsed.width);
  } catch {
    return defaultWidth;
  }
}

/**
 * Save files panel width to localStorage
 */
export function saveFilesPanelWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    const clampedWidth = clampWidth(width);
    localStorage.setItem(
      PANEL_STORAGE_KEYS.FILES,
      JSON.stringify({ width: clampedWidth } satisfies SavedPanelWidth),
    );
  } catch (error) {
    console.warn('Error saving files panel width:', error);
  }
}

/**
 * Validate a width value is within panel bounds
 */
export function isValidPanelWidth(width: number): boolean {
  return (
    typeof width === 'number' &&
    !isNaN(width) &&
    width >= PANEL_MIN_WIDTH &&
    width <= PANEL_MAX_WIDTH
  );
}
