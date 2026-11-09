import { renderHook, act, waitFor } from '@testing-library/react';
import useChatInstance, { chatInstanceStorageKey } from '../../hooks/useChatInstance';

const lazyBase = { chatModelId: 'assistant', lang: 'fr', config: { apiUrl: 'http://core.test', lazyConversation: true } };
const eagerBase = { chatModelId: 'assistant', lang: 'fr', config: { apiUrl: 'http://core.test' } };
const key = () => chatInstanceStorageKey('http://core.test', 'assistant', undefined, false, '');
const created = (id: string) => ({ ok: true, status: 200, json: async () => ({ chatInstanceId: id }) });
const purged = { ok: false, status: 404, json: async () => ({ code: 'CONVERSATION_NOT_FOUND' }) };
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
  localStorage.clear(); request.mockReset(); global.fetch = request;
});
afterEach(() => { global.fetch = oldFetch; });

it('lazy: a purged conversation is forgotten without error, and nothing is created', async () => {
  localStorage.setItem(key(), 'purged');
  localStorage.setItem(`${key()}:creation`, 'a'.repeat(64));
  request.mockResolvedValueOnce(purged);
  const { result } = renderHook(() => useChatInstance(lazyBase));
  await waitFor(() => expect(result.current.isChanging).toBe(false));
  expect(result.current.error).toBeNull();
  expect(result.current.chatInstanceId).toBe('');
  expect(localStorage.getItem(key())).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  // The first message then creates a conversation with a fresh creation key.
  request.mockResolvedValueOnce(created('fresh'));
  await act(async () => { expect(await result.current.ensureInstance()).toBe('fresh'); });
  expect(bodies()[1].chatInstanceId).toBeUndefined();
  expect(bodies()[1].creationKey).not.toBe('a'.repeat(64));
});

it('eager: a purged conversation is replaced by a new one, without error', async () => {
  localStorage.setItem(key(), 'purged');
  request.mockResolvedValueOnce(purged).mockResolvedValueOnce(created('fresh'));
  const { result } = renderHook(() => useChatInstance(eagerBase));
  await waitFor(() => expect(result.current.chatInstanceId).toBe('fresh'));
  expect(result.current.error).toBeNull();
  // The Core only answers 404 to a client that says it handles it.
  expect(bodies()[0]).toMatchObject({ resumeOnly: true, chatInstanceId: 'purged', acceptsNotFound: true });
  expect(bodies()[1].chatInstanceId).toBeUndefined();
  expect(localStorage.getItem(key())).toBe('fresh');
});

it('any other refusal still fails closed (a ban is not a purge)', async () => {
  localStorage.setItem(key(), 'locked');
  request.mockResolvedValue({ ok: false, status: 403, json: async () => ({ code: 'BANNED' }) });
  const { result } = renderHook(() => useChatInstance(eagerBase));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(bodies().every(body => body.chatInstanceId === 'locked')).toBe(true);
});
