import { beforeEach, describe, expect, it } from 'vitest';
import { useNotificationStore } from '@/stores/notificationStore';

beforeEach(() => {
  useNotificationStore.setState({
    support: 'unsupported',
    registrationState: 'disabled',
    permission: 'default',
    registration: null,
    error: null,
    notifyCompletion: true,
    notifyPermission: true,
  });
  localStorage.clear();
});

describe('notificationStore', () => {
  it('starts in disabled/unsupported state', () => {
    const state = useNotificationStore.getState();
    expect(state.support).toBe('unsupported');
    expect(state.registrationState).toBe('disabled');
    expect(state.registration).toBeNull();
  });

  it('setRegistration moves state to enabled and persists', async () => {
    await new Promise<void>((resolve) => {
      useNotificationStore.getState().setRegistration({
        serverId: 'srv-1',
        serverName: 'Test Server',
        serverUrl: 'https://test.example.com',
        subscriptionId: 'sub-1',
        enabledAt: Date.now(),
      });
      // setRegistration fires async persist, give it a tick
      setTimeout(resolve, 10);
    });

    const state = useNotificationStore.getState();
    expect(state.registrationState).toBe('enabled');
    expect(state.registration?.serverId).toBe('srv-1');
    expect(state.registration?.subscriptionId).toBe('sub-1');
  });

  it('reset clears registration and error', () => {
    useNotificationStore.setState({
      registrationState: 'enabled',
      registration: {
        serverId: 'srv-1',
        serverName: 'Test',
        serverUrl: 'https://test.example.com',
        subscriptionId: 'sub-1',
        enabledAt: Date.now(),
      },
      error: 'some error',
    });

    useNotificationStore.getState().reset();

    expect(useNotificationStore.getState().registrationState).toBe('disabled');
    expect(useNotificationStore.getState().registration).toBeNull();
    expect(useNotificationStore.getState().error).toBeNull();
  });

  it('setNotifyCompletion updates state and persists to localStorage', () => {
    useNotificationStore.getState().setNotifyCompletion(false);
    expect(useNotificationStore.getState().notifyCompletion).toBe(false);
    expect(localStorage.getItem('prokopai_notify_completion')).toBe('false');
  });

  it('setNotifyPermission updates state and persists to localStorage', () => {
    useNotificationStore.getState().setNotifyPermission(false);
    expect(useNotificationStore.getState().notifyPermission).toBe(false);
    expect(localStorage.getItem('prokopai_notify_permission')).toBe('false');
  });

  it('setError sets error message', () => {
    useNotificationStore.getState().setError('Something went wrong');
    expect(useNotificationStore.getState().error).toBe('Something went wrong');
  });
});
