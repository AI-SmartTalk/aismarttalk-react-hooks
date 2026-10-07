import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import useChatInstance, { chatInstanceStorageKey, chatActiveSelectionKey } from '../../hooks/useChatInstance';

const base = { chatModelId: 'assistant', lang: 'fr', config: { apiUrl: 'http://core.test' } };
const account = { id: 'alice', email: 'alice@example.test', token: 'valid-alice' };
const anonymous = { id: 'anonymous', email: 'anonymous@example.com' };
const key = (user?: typeof account | typeof anonymous, namespace = '') => chatInstanceStorageKey('http://core.test', 'assistant', user, false, namespace);
const activeKey = (namespace = '', user?: typeof account | typeof anonymous) => chatActiveSelectionKey('http://core.test', 'assistant', false, namespace, user);
const publish = (id: string) => { const value = JSON.stringify({ id, identity: 'visitor' }); localStorage.setItem(activeKey(), value); window.dispatchEvent(new StorageEvent('storage', { key: activeKey(), newValue: value })); };
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
it.each([[403, 'CONVERSATION_ACCESS_DENIED'], [404, 'NOT_FOUND']])('keeps an inaccessible selection and requires an explicit recovery (%s)', async (status, code) => {
  localStorage.setItem(key(account), 'old');
  request.mockResolvedValue(refusal(status as number, code as string));
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(result.current.error).toMatchObject({ code, conversationId: 'old' }));
  expect(result.current.chatInstanceId).toBe('');
  expect(request).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key(account))).toBe('old');
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
it('logout creates a fresh guest thread, and auto-login after reload continues that same thread', async () => {
  localStorage.setItem(key(anonymous), 'ancient-guest');
  localStorage.setItem(key(account), 'old-account');
  request.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.chatInstanceId) return response(body.chatInstanceId);
    return { ...response('new-guest'), json: async () => ({ chatInstanceId: 'new-guest', visitorToken: 'guest-proof' }) };
  });
  const first = renderHook(({ user }) => useChatInstance({ ...base, user }), { initialProps: { user: account as typeof account | typeof anonymous } });
  await waitFor(() => expect(first.result.current.chatInstanceId).toBe('old-account'));
  act(() => first.result.current.beginAnonymousSession());
  first.rerender({ user: anonymous });
  await waitFor(() => expect(first.result.current.chatInstanceId).toBe('new-guest'));
  expect(JSON.parse(request.mock.calls[1][1].body).chatInstanceId).toBeUndefined();
  first.unmount();
  const refreshed = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(refreshed.result.current.chatInstanceId).toBe('new-guest'));
  expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ chatInstanceId: 'new-guest', resumeOnly: true, claimAnonymous: true });
  expect(request.mock.calls[2][1].headers['x-chat-visitor-token']).toBe('guest-proof');
});
it('an expired identity locks the account conversation, and reauthentication resumes it', async () => {
  request.mockImplementation(async (_url, options) => options.headers.Authorization ? response('owned') : refusal(401, 'AUTH_REQUIRED'));
  const { result, rerender } = renderHook(({ user }) => useChatInstance({ ...base, user }), { initialProps: { user: account as typeof account | typeof anonymous } });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('owned'));
  rerender({ user: anonymous });
  await waitFor(() => expect(result.current.error).toMatchObject({ code: 'AUTH_REQUIRED', conversationId: 'owned' }));
  expect(result.current.chatInstanceId).toBe('');
  expect(JSON.parse(request.mock.calls[1][1].body).chatInstanceId).toBe('owned');
  rerender({ user: account });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('owned'));
  expect(request).toHaveBeenCalledTimes(3);
});
it('does not replace a locked conversation when another account signs in', async () => {
  request.mockResolvedValueOnce(response('alice-thread')).mockResolvedValue(refusal(403, 'CONVERSATION_ACCESS_DENIED'));
  const { result, rerender } = renderHook(({ user }) => useChatInstance({ ...base, user }), { initialProps: { user: account } });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('alice-thread'));
  rerender({ user: { ...account, id: 'bob', token: 'bob-token' } });
  await waitFor(() => expect(result.current.error).toMatchObject({ conversationId: 'alice-thread', code: 'CONVERSATION_ACCESS_DENIED' }));
  expect(result.current.chatInstanceId).toBe('');
  expect(request).toHaveBeenCalledTimes(2);
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
it('isolates an anonymous preview from visitor and account selections on the same site', async () => {
  localStorage.setItem(key(anonymous), 'storefront-visitor-thread');
  localStorage.setItem(key(account), 'admin-account-thread');
  localStorage.setItem(activeKey(), JSON.stringify({ id: 'admin-account-thread', identity: 'user:alice' }));
  localStorage.setItem(activeKey('admin-preview', account), JSON.stringify({ id: 'prior-preview-account-thread', identity: 'user:alice' }));
  const preview = { ...base, config: { ...base.config, storageNamespace: 'admin-preview' } };
  const { result } = renderHook(() => useChatInstance(preview));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('chatInstanceId');
  expect(localStorage.getItem(key(anonymous))).toBe('storefront-visitor-thread');
  expect(localStorage.getItem(key(account))).toBe('admin-account-thread');
  expect(localStorage.getItem(activeKey())).toContain('admin-account-thread');
  expect(localStorage.getItem(key(anonymous, 'admin-preview'))).toBe('created');
  expect(localStorage.getItem(activeKey('admin-preview', anonymous))).toContain('created');
  expect(localStorage.getItem(activeKey('admin-preview', account))).toContain('prior-preview-account-thread');
});
it('starts a fresh anonymous preview session after logout from a signed-in preview', async () => {
  const namespace = 'admin-preview';
  localStorage.setItem(key(anonymous, namespace), 'old-guest-preview');
  request.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    return response(body.chatInstanceId || (options.headers.Authorization ? 'account-preview' : 'fresh-guest-preview'));
  });
  const { result, rerender } = renderHook(({ user }) => useChatInstance({ ...base, config: { ...base.config, storageNamespace: namespace }, user }), {
    initialProps: { user: account as typeof account | typeof anonymous },
  });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('account-preview'));
  act(() => result.current.beginAnonymousSession());
  rerender({ user: anonymous });
  await waitFor(() => expect(result.current.chatInstanceId).toBe('fresh-guest-preview'));
  expect(JSON.parse(request.mock.calls[1][1].body)).not.toHaveProperty('chatInstanceId');
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
  localStorage.setItem(activeKey(), JSON.stringify({ id: 'selected', identity: 'visitor' }));
  act(() => { publish('selected'); });
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
  localStorage.setItem(activeKey(), JSON.stringify({ id: 'shared', identity: 'visitor' }));
  (localStorage.setItem as jest.Mock).mockClear();
  request.mockResolvedValue(response('shared'));
  act(() => publish('shared'));
  (localStorage.setItem as jest.Mock).mockClear();
  await waitFor(() => expect(result.current.chatInstanceId).toBe('shared'));
  expect(localStorage.setItem).not.toHaveBeenCalled();
});
it('ignores queued storage events superseded by a newer selection', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  localStorage.setItem(activeKey(), JSON.stringify({ id: 'latest', identity: 'visitor' }));
  request.mockClear().mockResolvedValue(response('latest'));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: activeKey(), newValue: JSON.stringify({ id: 'stale', identity: 'visitor' }) })));
  expect(request).not.toHaveBeenCalled();
  act(() => publish('latest'));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('latest'));
  expect(request).toHaveBeenCalledTimes(1);
});
it('does not accept a storage resume that finishes after a newer selection', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  let finish!: (data: any) => void;
  request.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  localStorage.setItem(activeKey(), JSON.stringify({ id: 'first', identity: 'visitor' }));
  act(() => publish('first'));
  localStorage.setItem(activeKey(), JSON.stringify({ id: 'newer', identity: 'visitor' }));
  await act(async () => { finish(response('first')); });
  expect(result.current.chatInstanceId).toBe('created');
  expect(JSON.parse(localStorage.getItem(activeKey())!).id).toBe('newer');
});

it('does not create in response to an inaccessible cross-tab selection', async () => {
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  localStorage.setItem(activeKey(), JSON.stringify({ id: 'unowned', identity: 'visitor' }));
  request.mockClear().mockResolvedValue(refusal(403, 'CONVERSATION_ACCESS_DENIED'));
  act(() => publish('unowned'));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.current.chatInstanceId).toBe('');
});

it('never claims a new visitor conversation received from another tab with an old account', async () => {
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  localStorage.setItem('chatVisitorToken:v1:new-guest', 'guest-secret');
  request.mockResolvedValue(response('new-guest'));
  act(() => { publish('new-guest'); });
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  const body = JSON.parse(request.mock.calls[1][1].body);
  expect(body).toMatchObject({ chatInstanceId: 'new-guest', resumeOnly: true });
  expect(body.claimAnonymous).toBeUndefined();
});

it.each(['LOGIN_REQUIRED', 'SESSION_EXPIRED', 'CONVERSATION_LOGIN_REQUIRED'])('preserves the server authentication reason for correct recovery (%s)', async reason => {
  request.mockResolvedValue({ok:false,status:401,json:async()=>({code:'AUTH_REQUIRED',reason})});
  const {result}=renderHook(()=>useChatInstance(base));
  await waitFor(()=>expect(result.current.error).toMatchObject({status:401,code:'AUTH_REQUIRED',reason}));
  expect(request).toHaveBeenCalledTimes(1);
});

it('replaces only an inaccessible legacy visitor with a fresh proven conversation', async () => {
  localStorage.setItem('chatInstanceId[assistant-standard]', 'legacy-guest');
  request.mockResolvedValueOnce(refusal(403, 'CONVERSATION_ACCESS_DENIED'))
    .mockResolvedValueOnce({ ...response('fresh'), json: async () => ({ chatInstanceId: 'fresh', visitorToken: 'proof' }) });
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('fresh'));
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.parse(request.mock.calls[1][1].body).chatInstanceId).toBeUndefined();
  expect(localStorage.getItem('chatInstanceId[assistant-standard]')).toBeNull();
  expect(localStorage.getItem('chatVisitorToken:v1:fresh')).toBe('proof');
});
it.each([[401, 'AUTH_REQUIRED'], [403, 'BANNED'], [503, 'UNAVAILABLE']])('does not migrate a legacy guest on auth, ban or outage (%s)', async (status, code) => {
  localStorage.setItem('chatInstanceId[assistant-standard]', 'legacy');
  request.mockResolvedValue(refusal(status as number, code as string));
  const { result } = renderHook(() => useChatInstance(base));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(request).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('chatInstanceId[assistant-standard]')).toBe('legacy');
});

it('keeps a legacy account refusal locked without automatic creation', async () => {
  localStorage.setItem('chatInstanceId[assistant-standard]', 'legacy-account');
  request.mockResolvedValue(refusal(403, 'CONVERSATION_ACCESS_DENIED'));
  const { result } = renderHook(() => useChatInstance({ ...base, user: account }));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(request).toHaveBeenCalledTimes(1);
});
it('keeps a modern visitor selection locked instead of silently discarding it', async () => {
  localStorage.setItem(key(anonymous), 'modern');
  request.mockResolvedValue(refusal(403, 'CONVERSATION_ACCESS_DENIED'));
  const { result } = renderHook(() => useChatInstance({ ...base, user: anonymous }));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(request).toHaveBeenCalledTimes(1);
});
