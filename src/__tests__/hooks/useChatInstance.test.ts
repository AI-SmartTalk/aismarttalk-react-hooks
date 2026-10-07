import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import useChatInstance, { chatInstanceStorageKey } from '../../hooks/useChatInstance';

const base = { chatModelId: 'assistant', lang: 'fr', config: { apiUrl: 'http://core.test' } };
const account = { id: 'alice', email: 'alice@example.test', token: 'valid-alice' };
const anonymous = { id: 'anonymous', email: 'anonymous@example.com' };
const key = (user?: typeof account | typeof anonymous) => chatInstanceStorageKey('http://core.test', 'assistant', user);
const response = (id: string) => ({ ok: true, status: 200, json: async () => ({ chatInstanceId: id }) });
const refusal = (status: number, code: string) => ({ ok: false, status, json: async () => ({ code }) });
const request = jest.fn();
const oldFetch = global.fetch;

beforeEach(() => {
  const data = new Map<string, string>();
  (localStorage.getItem as jest.Mock).mockImplementation((key: string) => data.get(key) || null);
  (localStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => data.set(key, value));
  (localStorage.removeItem as jest.Mock).mockImplementation((key: string) => data.delete(key));
  (localStorage.clear as jest.Mock).mockImplementation(() => data.clear());
  localStorage.clear(); request.mockReset().mockResolvedValue(response('created')); global.fetch = request; });
afterEach(() => { global.fetch = oldFetch; });

it('creates one instance and persists it in a scoped key', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  expect(result.current.chatInstanceId).toBe('');
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  expect(request).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key())).toBe('created');
  expect(localStorage.getItem('chatInstanceId[assistant-standard]')).toBeNull();
});
it('validates a scoped instance before exposing it', async () => {
  localStorage.setItem(key(account), 'owned');
  request.mockResolvedValue(response('owned'));
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  expect(result.current.chatInstanceId).toBe('');
  await waitFor(() => expect(result.current.chatInstanceId).toBe('owned'));
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ resumeOnly: true, chatInstanceId: 'owned' });
});
it('migrates legacy storage only after continuation admission', async () => {
  localStorage.setItem('chatInstanceId[assistant-standard]', 'legacy');
  request.mockResolvedValue(response('legacy'));
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('legacy'));
  expect(localStorage.getItem(key())).toBe('legacy');
});
it.each([[403, 'CONVERSATION_ACCESS_DENIED'], [404, 'NOT_FOUND']])('replaces only an unowned or missing instance (%s)', async (status, code) => {
  localStorage.setItem(key(account), 'old');
  request.mockResolvedValueOnce(refusal(status as number, code as string)).mockResolvedValueOnce(response('new'));
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('new'));
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(request.mock.calls[1][1].body).resumeOnly).toBeUndefined();
});
it.each([[401, 'AUTH_REQUIRED'], [403, 'BANNED'], [429, 'RATE_LIMITED'], [503, 'UNAVAILABLE']])('does not bypass refusal %s by creating a conversation', async (status, code) => {
  localStorage.setItem(key(account), 'old'); request.mockResolvedValue(refusal(status as number, code as string));
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.chatInstanceId).toBe(''); expect(result.current.isChanging).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
});
it('recovers from a network failure without erasing the stored conversation', async () => {
  localStorage.setItem(key(account), 'owned'); request.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(localStorage.getItem(key(account))).toBe('owned');
  request.mockResolvedValue(response('owned'));
  await act(async () => { await result.current.retry(); });
  expect(result.current.chatInstanceId).toBe('owned');
});
it('keeps the admitted instance when manual creation fails', async () => {
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  request.mockRejectedValue(new Error('offline'));
  await act(async () => { await result.current.getNewInstance(); });
  expect(result.current.chatInstanceId).toBe('created');
  expect(localStorage.getItem(key(account))).toBe('created');
});
it('covers auto-login → logout → anonymous conversation → refresh → auto-login', async () => {
  request.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    return response(body.chatInstanceId || (options.headers.Authorization ? 'alice-conversation' : 'visitor-conversation'));
  });
  const first = renderHook(({ user }) => useChatInstance({ ...base, user }), { initialProps: { user: account as typeof account | typeof anonymous } });
  await waitFor(() => expect(first.result.current.chatInstanceId).toBe('alice-conversation'));
  first.rerender({ user: anonymous });
  expect(first.result.current.chatInstanceId).toBe('');
  await waitFor(() => expect(first.result.current.chatInstanceId).toBe('visitor-conversation'));
  first.unmount();
  const refreshed = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(refreshed.result.current.chatInstanceId).toBe('alice-conversation'));
  expect(localStorage.getItem(key(anonymous))).toBe('visitor-conversation');
  expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ chatInstanceId: 'alice-conversation', resumeOnly: true });
});
it('ignores a late response after switching identity even if fetch ignores abort', async () => {
  let finish!: (data: any) => void;
  request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(response('bob-conversation'));
  const { result, rerender } = renderHook(({ user }) => useChatInstance({ ...base, user }), { initialProps: { user: account } });
  rerender({ user: { ...account, id: 'bob', token: 'bob-token' } });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('bob-conversation'));
  await act(async () => { finish(response('alice-late')); });
  expect(result.current.chatInstanceId).toBe('bob-conversation');
  expect(localStorage.getItem(key(account))).toBeNull();
});
it('coalesces concurrent creation requests', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  request.mockClear();
  await act(async () => { await Promise.all([result.current.getNewInstance(), result.current.getNewInstance()]); });
  expect(request).toHaveBeenCalledTimes(1);
});
it('keeps API and assistant contexts isolated', () => {
  expect(key(account)).not.toBe(chatInstanceStorageKey('http://another.test', 'assistant', account));
  expect(key(account)).not.toBe(chatInstanceStorageKey('http://core.test', 'another', account));
});
it('renews a token without creating another owned conversation', async () => {
  request.mockImplementation(async (_url, options) => response(JSON.parse(options.body).chatInstanceId || 'owned'));
  const { result, rerender } = renderHook(({ user }) => useChatInstance({ ...base, user }), { initialProps: { user: account } });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('owned'));
  rerender({ user: { ...account, token: 'renewed-token' } });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ resumeOnly: true, chatInstanceId: 'owned' });
});
it('validates a cross-tab selection before accepting it', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  request.mockResolvedValue(response('selected'));
  localStorage.setItem(key(), 'selected');
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: 'selected' })); });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('selected'));
});

it('initializes under React StrictMode after the first effect is aborted', async () => {
  const { result } = renderHook(() => useChatInstance(base), { wrapper: React.StrictMode });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
});

it('rejects an incompatible API resume response without publishing or retrying', async () => {
  localStorage.setItem(key(), 'owned');
  request.mockResolvedValue(response('unexpected-new'));
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.error).toMatchObject({ code: 'CONVERSATION_RESUME_MISMATCH' }));
  expect(result.current.chatInstanceId).toBe('');
  expect(localStorage.getItem(key())).toBe('owned');
  expect(request).toHaveBeenCalledTimes(1);
});
it('adopts a shared selection without echoing it to other tabs', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  localStorage.setItem(key(), 'shared');
  (localStorage.setItem as jest.Mock).mockClear();
  request.mockResolvedValue(response('shared'));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: 'shared' })));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('shared'));
  expect(localStorage.setItem).not.toHaveBeenCalled();
});
it('ignores queued storage events superseded by a newer selection', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  localStorage.setItem(key(), 'latest');
  request.mockClear().mockResolvedValue(response('latest'));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: 'stale' })));
  expect(request).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: 'latest' })));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('latest'));
  expect(request).toHaveBeenCalledTimes(1);
});
it('does not accept a storage resume that finishes after a newer selection', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  let finish!: (data: any) => void;
  request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  localStorage.setItem(key(), 'first');
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: 'first' })));
  localStorage.setItem(key(), 'newer');
  await act(async () => { finish(response('first')); });
  expect(result.current.chatInstanceId).toBe('created');
  expect(localStorage.getItem(key())).toBe('newer');
});

it('does not create in response to an inaccessible cross-tab selection', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  localStorage.setItem(key(), 'unowned');
  request.mockClear().mockResolvedValue(refusal(403, 'CONVERSATION_ACCESS_DENIED'));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: key(), newValue: 'unowned' })));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.current.chatInstanceId).toBe('created');
});
