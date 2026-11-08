import { renderHook, act, waitFor } from '@testing-library/react';
import useChatInstance, { chatInstanceStorageKey } from '../../hooks/useChatInstance';

const lazyBase = { chatModelId: 'assistant', lang: 'fr', config: { apiUrl: 'http://core.test', lazyConversation: true } };
const eagerBase = { chatModelId: 'assistant', lang: 'fr', config: { apiUrl: 'http://core.test' } };
const key = () => chatInstanceStorageKey('http://core.test', 'assistant', undefined, false, '');
const response = (id: string) => ({ ok: true, status: 200, json: async () => ({ chatInstanceId: id }) });
const request = jest.fn();
const oldFetch = global.fetch;
const bodies = () => request.mock.calls.map(call => JSON.parse(call[1].body));

beforeEach(() => {
  sessionStorage.clear();
  const data = new Map<string, string>();
  (localStorage.getItem as jest.Mock).mockImplementation((k: string) => data.get(k) || null);
  (localStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => data.set(k, v));
  (localStorage.removeItem as jest.Mock).mockImplementation((k: string) => data.delete(k));
  (localStorage.clear as jest.Mock).mockImplementation(() => data.clear());
  localStorage.clear(); request.mockReset().mockResolvedValue(response('created')); global.fetch = request;
});
afterEach(() => { global.fetch = oldFetch; });

it('lazy: creates nothing on mount when no conversation is saved', async () => {
  const { result } = renderHook(() => useChatInstance(lazyBase));
  await act(async () => {});
  expect(request).not.toHaveBeenCalled();
  expect(result.current.chatInstanceId).toBe('');
  expect(result.current.error).toBeNull();
  expect(result.current.isChanging).toBe(false);
});

it('lazy: still resumes a saved conversation on mount', async () => {
  localStorage.setItem(key(), 'saved');
  request.mockResolvedValue(response('saved'));
  const { result } = renderHook(() => useChatInstance(lazyBase));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('saved'));
  expect(request).toHaveBeenCalledTimes(1);
  expect(bodies()[0]).toMatchObject({ resumeOnly: true, chatInstanceId: 'saved' });
});

it('lazy: ensureInstance creates exactly once under concurrent calls', async () => {
  const { result } = renderHook(() => useChatInstance(lazyBase));
  await act(async () => {});
  let ids: (string | null)[] = [];
  await act(async () => { ids = await Promise.all([result.current.ensureInstance(), result.current.ensureInstance(), result.current.ensureInstance()]); });
  expect(ids).toEqual(['created', 'created', 'created']);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe('http://core.test/api/chat/createInstance');
  expect(bodies()[0].creationKey).toBe(localStorage.getItem(`${key()}:creation`));
  expect(result.current.chatInstanceId).toBe('created');
  await act(async () => { expect(await result.current.ensureInstance()).toBe('created'); });
  expect(request).toHaveBeenCalledTimes(1);
});

it('lazy: ensureInstance reuses the stored creation key after a lost response', async () => {
  const { result } = renderHook(() => useChatInstance(lazyBase));
  await act(async () => {});
  request.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { expect(await result.current.ensureInstance()).toBeNull(); });
  await act(async () => { expect(await result.current.ensureInstance()).toBe('created'); });
  expect(bodies()[0].creationKey).toBeTruthy();
  expect(bodies()[1].creationKey).toBe(bodies()[0].creationKey);
});

it('lazy: ensureInstance never replaces a saved conversation it cannot resume', async () => {
  localStorage.setItem(key(), 'locked');
  request.mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'BANNED' }) });
  const { result } = renderHook(() => useChatInstance(lazyBase));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  await act(async () => { expect(await result.current.ensureInstance()).toBeNull(); });
  expect(bodies().every(body => body.chatInstanceId === 'locked')).toBe(true);
});

it('lazy: a new chat makes no request and the next ensure creates with a new creation key', async () => {
  const { result } = renderHook(() => useChatInstance(lazyBase));
  await act(async () => {});
  await act(async () => { await result.current.ensureInstance(); });
  const firstKey = bodies()[0].creationKey;
  let fresh: string | null = 'unset';
  await act(async () => { fresh = await result.current.getNewInstance(); });
  expect(fresh).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.current.chatInstanceId).toBe('');
  request.mockResolvedValue(response('second'));
  await act(async () => { expect(await result.current.ensureInstance()).toBe('second'); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(bodies()[1]).not.toHaveProperty('chatInstanceId');
  expect(bodies()[1].creationKey).toBeTruthy();
  expect(bodies()[1].creationKey).not.toBe(firstKey);
  expect(result.current.chatInstanceId).toBe('second');
});

it('lazy: a reload after a new chat does not resume the previous conversation nor create one', async () => {
  const first = renderHook(() => useChatInstance(lazyBase));
  await act(async () => {});
  await act(async () => { await first.result.current.ensureInstance(); });
  await act(async () => { await first.result.current.getNewInstance(); });
  first.unmount();
  request.mockClear();
  const reloaded = renderHook(() => useChatInstance(lazyBase));
  await act(async () => {});
  expect(request).not.toHaveBeenCalled();
  expect(reloaded.result.current.chatInstanceId).toBe('');
});

it('non-lazy: mount still creates a conversation', async () => {
  const { result } = renderHook(() => useChatInstance(eagerBase));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('created'));
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe('http://core.test/api/chat/createInstance');
  expect(bodies()[0]).not.toHaveProperty('chatInstanceId');
});
