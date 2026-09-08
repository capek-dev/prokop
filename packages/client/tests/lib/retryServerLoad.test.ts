import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AuthError, ServerError } from '@prokopai/sdk';
import { retryServerLoad } from '@/lib/retryServerLoad';

let controller: AbortController;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  controller = new AbortController();
});
afterEach(() => {
  controller.abort();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('connection refusal and 503 recover automatically', async () => {
  const load = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockRejectedValueOnce(new ServerError('Unavailable', 503)).mockResolvedValue('ready');
  const result = retryServerLoad(load, controller.signal);
  await vi.advanceTimersByTimeAsync(2700);
  expect(await result).toBe('ready');
  expect(load).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

test.each([new AuthError('Invalid token'), new SyntaxError('Bad JSON'), new TypeError('Cannot read properties of null')])('does not retry %s', async error => {
  const load = vi.fn().mockRejectedValue(error);
  await expect(retryServerLoad(load, controller.signal)).rejects.toBe(error);
  expect(load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('navigation cancels the retry wait and removes wake listeners', async () => {
  const load = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  const result = retryServerLoad(load, controller.signal).catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await result).toMatchObject({ name: 'AbortError' });
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('hung attempts time out and abort before retrying', async () => {
  let firstSignal: AbortSignal | undefined;
  const load = vi.fn().mockImplementationOnce((signal: AbortSignal) => {
    firstSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  }).mockResolvedValue('ready');
  const result = retryServerLoad(load, controller.signal);
  await vi.advanceTimersByTimeAsync(10_900);
  expect(await result).toBe('ready');
  expect(firstSignal?.aborted).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
});

test.each(['online', 'visibilitychange'])('%s wakes retries without overlapping attempts', async event => {
  const load = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue('ready');
  const result = retryServerLoad(load, controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  const target = event === 'online' ? window : document;
  target.dispatchEvent(new Event(event));
  target.dispatchEvent(new Event(event));
  expect(await result).toBe('ready');
  expect(load).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('navigation aborts active requests and ignores late success', async () => {
  let resolve!: (value: string) => void;
  let attemptSignal: AbortSignal | undefined;
  const result = retryServerLoad(signal => {
    attemptSignal = signal;
    return new Promise<string>(done => { resolve = done; });
  }, controller.signal).catch(error => error);
  controller.abort();
  expect(attemptSignal?.aborted).toBe(true);
  resolve('late');
  expect(await result).toMatchObject({ name: 'AbortError' });
  expect(vi.getTimerCount()).toBe(0);
});
