import { describe, test, expect, beforeEach } from 'vitest';
import { mockLocalStorage } from '../helpers';
import { useUIStore } from '@/stores/uiStore';


describe('uiStore', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = mockLocalStorage();
    useUIStore.setState({
      showSettings: false,
      showConfiguration: false,
      showTools: false,
      showMCPDialog: false,
      showWorkspacePermissions: false,
      chatFinishSoundEnabled: true,
      permissionSoundEnabled: true,
      filePreviewTarget: null,
    });
  });

  // --- Dialog State ---
  describe('dialogs', () => {
    describe('showSettings', () => {
      test('starts false', () => {
        expect(useUIStore.getState().showSettings).toBe(false);
      });

      test('setShowSettings opens dialog', () => {
        useUIStore.getState().setShowSettings(true);
        expect(useUIStore.getState().showSettings).toBe(true);
      });

      test('setShowSettings closes dialog', () => {
        useUIStore.getState().setShowSettings(true);
        useUIStore.getState().setShowSettings(false);
        expect(useUIStore.getState().showSettings).toBe(false);
      });
    });

    describe('showConfiguration', () => {
      test('starts false', () => {
        expect(useUIStore.getState().showConfiguration).toBe(false);
      });

      test('setShowConfiguration toggles', () => {
        useUIStore.getState().setShowConfiguration(true);
        expect(useUIStore.getState().showConfiguration).toBe(true);
      });
    });

    describe('showTools', () => {
      test('starts false', () => {
        expect(useUIStore.getState().showTools).toBe(false);
      });

      test('setShowTools toggles', () => {
        useUIStore.getState().setShowTools(true);
        expect(useUIStore.getState().showTools).toBe(true);
      });
    });

    describe('showMCPDialog', () => {
      test('starts false', () => {
        expect(useUIStore.getState().showMCPDialog).toBe(false);
      });

      test('setShowMCPDialog toggles', () => {
        useUIStore.getState().setShowMCPDialog(true);
        expect(useUIStore.getState().showMCPDialog).toBe(true);
      });
    });

    describe('showWorkspacePermissions', () => {
      test('starts false', () => {
        expect(useUIStore.getState().showWorkspacePermissions).toBe(false);
      });

      test('setShowWorkspacePermissions toggles', () => {
        useUIStore.getState().setShowWorkspacePermissions(true);
        expect(useUIStore.getState().showWorkspacePermissions).toBe(true);
      });
    });
  });

  // --- Settings (localStorage-backed) ---
  describe('sound settings', () => {
    describe('chatFinishSoundEnabled', () => {
      test('defaults to true', () => {
        expect(useUIStore.getState().chatFinishSoundEnabled).toBe(true);
      });

      test('setChatFinishSoundEnabled sets to false', () => {
        useUIStore.getState().setChatFinishSoundEnabled(false);
        expect(useUIStore.getState().chatFinishSoundEnabled).toBe(false);
      });

      test('setChatFinishSoundEnabled sets back to true', () => {
        useUIStore.getState().setChatFinishSoundEnabled(false);
        useUIStore.getState().setChatFinishSoundEnabled(true);
        expect(useUIStore.getState().chatFinishSoundEnabled).toBe(true);
      });

      test('persists to localStorage', () => {
        useUIStore.getState().setChatFinishSoundEnabled(false);
        expect(storage.getItem('prokopai_sound_chat_finish_enabled')).toBe('false');
      });

      test('persists true to localStorage', () => {
        useUIStore.getState().setChatFinishSoundEnabled(true);
        expect(storage.getItem('prokopai_sound_chat_finish_enabled')).toBe('true');
      });

      test('reads persisted value from localStorage', () => {
        storage.setItem('prokopai_sound_chat_finish_enabled', 'false');
        useUIStore.setState({ chatFinishSoundEnabled: false });
        expect(useUIStore.getState().chatFinishSoundEnabled).toBe(false);
      });
    });

    describe('permissionSoundEnabled', () => {
      test('defaults to true', () => {
        expect(useUIStore.getState().permissionSoundEnabled).toBe(true);
      });

      test('setPermissionSoundEnabled sets to false', () => {
        useUIStore.getState().setPermissionSoundEnabled(false);
        expect(useUIStore.getState().permissionSoundEnabled).toBe(false);
      });

      test('persists to localStorage', () => {
        useUIStore.getState().setPermissionSoundEnabled(false);
        expect(storage.getItem('prokopai_sound_permission_enabled')).toBe('false');
      });

      test('persists true to localStorage', () => {
        useUIStore.getState().setPermissionSoundEnabled(true);
        expect(storage.getItem('prokopai_sound_permission_enabled')).toBe('true');
      });

      test('reads persisted value from localStorage', () => {
        storage.setItem('prokopai_sound_permission_enabled', 'false');
        useUIStore.setState({ permissionSoundEnabled: false });
        expect(useUIStore.getState().permissionSoundEnabled).toBe(false);
      });
    });
  });

  // --- File Preview ---
  describe('file preview', () => {
    test('filePreviewTarget starts null', () => {
      expect(useUIStore.getState().filePreviewTarget).toBeNull();
    });

    test('openFilePreview sets target', () => {
      const target = { workspaceId: 'ws-1', path: '/src/index.ts', name: 'index.ts' };
      useUIStore.getState().openFilePreview(target);
      expect(useUIStore.getState().filePreviewTarget).toEqual(target);
    });

    test('openFilePreview replaces previous target', () => {
      const target1 = { workspaceId: 'ws-1', path: '/a.ts', name: 'a.ts' };
      const target2 = { workspaceId: 'ws-2', path: '/b.ts', name: 'b.ts' };
      useUIStore.getState().openFilePreview(target1);
      useUIStore.getState().openFilePreview(target2);
      expect(useUIStore.getState().filePreviewTarget).toEqual(target2);
    });

    test('closeFilePreview clears target', () => {
      const target = { workspaceId: 'ws-1', path: '/src/index.ts', name: 'index.ts' };
      useUIStore.getState().openFilePreview(target);
      useUIStore.getState().closeFilePreview();
      expect(useUIStore.getState().filePreviewTarget).toBeNull();
    });

    test('closeFilePreview when already null is a no-op', () => {
      useUIStore.getState().closeFilePreview();
      expect(useUIStore.getState().filePreviewTarget).toBeNull();
    });
  });
});
