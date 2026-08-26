import { describe, test, expect, beforeEach } from 'vitest';
import { mockLocalStorage } from '../helpers';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH } from '@prokopai/sdk';

describe('chatLayoutStore', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = mockLocalStorage();
    useChatLayoutStore.setState({
      showFilesPanel: false,
      showTerminalPanel: false,
      sessionsPanelWidth: PANEL_DEFAULT_WIDTH,
      filesPanelWidth: PANEL_DEFAULT_WIDTH,
      mobileSurface: 'chat',
    });
  });

  // --- Initial State ---
  describe('initial state', () => {
    test('showFilesPanel starts false', () => {
      expect(useChatLayoutStore.getState().showFilesPanel).toBe(false);
    });

    test('showTerminalPanel starts false', () => {
      expect(useChatLayoutStore.getState().showTerminalPanel).toBe(false);
    });

    test('sessionsPanelWidth defaults to PANEL_DEFAULT_WIDTH', () => {
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(PANEL_DEFAULT_WIDTH);
    });

    test('filesPanelWidth defaults to PANEL_DEFAULT_WIDTH', () => {
      expect(useChatLayoutStore.getState().filesPanelWidth).toBe(PANEL_DEFAULT_WIDTH);
    });

    test('reads persisted sessions panel width from localStorage', () => {
      storage.setItem('prokopai_sessions_panel_width', JSON.stringify({ width: 300 }));
      useChatLayoutStore.setState({
        sessionsPanelWidth: 300,
      });
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(300);
    });

    test('reads persisted files panel width from localStorage', () => {
      storage.setItem('prokopai_files_panel_width', JSON.stringify({ width: 400 }));
      useChatLayoutStore.setState({
        filesPanelWidth: 400,
      });
      expect(useChatLayoutStore.getState().filesPanelWidth).toBe(400);
    });
  });

  // --- Panel Visibility ---
  describe('setShowFilesPanel', () => {
    test('sets showFilesPanel to true', () => {
      useChatLayoutStore.getState().setShowFilesPanel(true);
      expect(useChatLayoutStore.getState().showFilesPanel).toBe(true);
    });

    test('sets showFilesPanel back to false', () => {
      useChatLayoutStore.getState().setShowFilesPanel(true);
      useChatLayoutStore.getState().setShowFilesPanel(false);
      expect(useChatLayoutStore.getState().showFilesPanel).toBe(false);
    });
  });

  describe('mobileSurface', () => {
    test('moves between one primary phone surface at a time', () => {
      expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');

      useChatLayoutStore.getState().setMobileSurface('sessions');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('sessions');

      useChatLayoutStore.getState().setMobileSurface('files');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('files');

      useChatLayoutStore.getState().setMobileSurface('editor');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('editor');

      useChatLayoutStore.getState().setMobileSurface('chat');
      expect(useChatLayoutStore.getState().mobileSurface).toBe('chat');
    });
  });

  describe('setShowTerminalPanel', () => {
    test('sets showTerminalPanel to true', () => {
      useChatLayoutStore.getState().setShowTerminalPanel(true);
      expect(useChatLayoutStore.getState().showTerminalPanel).toBe(true);
    });

    test('sets showTerminalPanel back to false', () => {
      useChatLayoutStore.getState().setShowTerminalPanel(true);
      useChatLayoutStore.getState().setShowTerminalPanel(false);
      expect(useChatLayoutStore.getState().showTerminalPanel).toBe(false);
    });
  });

  // --- Panel Widths ---
  describe('setSessionsPanelWidth', () => {
    test('sets sessionsPanelWidth to valid value', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(300);
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(300);
    });

    test('clamps width to PANEL_MIN_WIDTH', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(50);
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(PANEL_MIN_WIDTH);
    });

    test('clamps width to PANEL_MAX_WIDTH', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(9999);
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(PANEL_MAX_WIDTH);
    });

    test('persists clamped width to localStorage', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(300);
      const stored = storage.getItem('prokopai_sessions_panel_width');
      expect(stored).toBe(JSON.stringify({ width: 300 }));
    });

    test('persists clamped value when input exceeds max', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(9999);
      const stored = storage.getItem('prokopai_sessions_panel_width');
      expect(stored).toBe(JSON.stringify({ width: PANEL_MAX_WIDTH }));
    });
  });

  describe('setFilesPanelWidth', () => {
    test('sets filesPanelWidth to valid value', () => {
      useChatLayoutStore.getState().setFilesPanelWidth(400);
      expect(useChatLayoutStore.getState().filesPanelWidth).toBe(400);
    });

    test('clamps width to PANEL_MIN_WIDTH', () => {
      useChatLayoutStore.getState().setFilesPanelWidth(10);
      expect(useChatLayoutStore.getState().filesPanelWidth).toBe(PANEL_MIN_WIDTH);
    });

    test('clamps width to PANEL_MAX_WIDTH', () => {
      useChatLayoutStore.getState().setFilesPanelWidth(10000);
      expect(useChatLayoutStore.getState().filesPanelWidth).toBe(PANEL_MAX_WIDTH);
    });

    test('persists clamped width to localStorage', () => {
      useChatLayoutStore.getState().setFilesPanelWidth(400);
      const stored = storage.getItem('prokopai_files_panel_width');
      expect(stored).toBe(JSON.stringify({ width: 400 }));
    });

    test('persists clamped value when input is below min', () => {
      useChatLayoutStore.getState().setFilesPanelWidth(0);
      const stored = storage.getItem('prokopai_files_panel_width');
      expect(stored).toBe(JSON.stringify({ width: PANEL_MIN_WIDTH }));
    });
  });

  // --- Boundary values ---
  describe('boundary width values', () => {
    test('accepts exact PANEL_MIN_WIDTH', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(PANEL_MIN_WIDTH);
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(PANEL_MIN_WIDTH);
    });

    test('accepts exact PANEL_MAX_WIDTH', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(PANEL_MAX_WIDTH);
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(PANEL_MAX_WIDTH);
    });

    test('accepts exact PANEL_DEFAULT_WIDTH', () => {
      useChatLayoutStore.getState().setSessionsPanelWidth(PANEL_DEFAULT_WIDTH);
      expect(useChatLayoutStore.getState().sessionsPanelWidth).toBe(PANEL_DEFAULT_WIDTH);
    });
  });
});
