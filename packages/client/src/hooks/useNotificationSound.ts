import { useCallback, useRef, useEffect } from 'react';
import chatFinishSound from '@/assets/sounds/chat-finish.mp3';
import chatPermissionSound from '@/assets/sounds/chat-permission.mp3';

type SoundKey = 'chatFinish' | 'chatPermission';

const SOUND_URLS: Record<SoundKey, string> = {
  chatFinish: chatFinishSound,
  chatPermission: chatPermissionSound,
};

interface UseNotificationSoundReturn {
  playChatFinishSound: () => void;
  playPermissionSound: () => void;
  playSound: (key: SoundKey) => void;
}

export function useNotificationSound(): UseNotificationSoundReturn {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Partial<Record<SoundKey, AudioBuffer>>>({});
  const unlockedRef = useRef(false);
  const pendingRef = useRef<SoundKey | null>(null);

  const getOrCreateContext = useCallback(async (): Promise<AudioContext> => {
    let ctx = audioCtxRef.current;

    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
      buffersRef.current = {};
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    return ctx;
  }, []);

  const loadBuffer = useCallback(async (key: SoundKey, ctx: AudioContext): Promise<AudioBuffer | null> => {
    if (buffersRef.current[key]) {
      return buffersRef.current[key] ?? null;
    }

    try {
      const response = await fetch(SOUND_URLS[key]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      buffersRef.current[key] = buffer;
      return buffer;
    } catch (err) {
      console.warn('[useNotificationSound] Failed to load', key, err);
      return null;
    }
  }, []);

  const playBuffer = useCallback((buffer: AudioBuffer, ctx: AudioContext) => {
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (err) {
      console.warn('[useNotificationSound] Playback error', err);
    }
  }, []);

  const unlock = useCallback(async () => {
    if (unlockedRef.current) return;

    const ctx = await getOrCreateContext();
    if (ctx.state !== 'running') return;

    const key = pendingRef.current;
    pendingRef.current = null;

    if (key) {
      const buffer = await loadBuffer(key, ctx);
      if (buffer) playBuffer(buffer, ctx);
    }

    unlockedRef.current = true;
  }, [getOrCreateContext, loadBuffer, playBuffer]);

  const attachGestureListeners = useCallback(() => {
    const onGesture = () => {
      document.removeEventListener('click', onGesture);
      document.removeEventListener('keydown', onGesture);
      document.removeEventListener('touchstart', onGesture);
      void unlock();
    };

    document.addEventListener('click', onGesture);
    document.addEventListener('keydown', onGesture);
    document.addEventListener('touchstart', onGesture);
  }, [unlock]);

  const playWebAudio = useCallback(async (key: SoundKey) => {
    if (unlockedRef.current) {
      const ctx = await getOrCreateContext();
      if (ctx.state !== 'running') return;
      const buffer = await loadBuffer(key, ctx);
      if (buffer) playBuffer(buffer, ctx);
      return;
    }

    pendingRef.current = key;
    attachGestureListeners();
  }, [getOrCreateContext, loadBuffer, playBuffer, attachGestureListeners]);

  const playSound = useCallback(async (key: SoundKey) => {
    await playWebAudio(key);
  }, [playWebAudio]);

  const playChatFinishSound = useCallback(() => {
    void playSound('chatFinish');
  }, [playSound]);

  const playPermissionSound = useCallback(() => {
    void playSound('chatPermission');
  }, [playSound]);

  useEffect(() => {
    return () => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== 'closed') {
        void ctx.close();
      }
      audioCtxRef.current = null;
    };
  }, []);

  return { playChatFinishSound, playPermissionSound, playSound };
}
