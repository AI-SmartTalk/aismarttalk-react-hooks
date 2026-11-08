import { act, renderHook, waitFor } from '@testing-library/react';
import { useChatMessages } from './useChatMessage';
import { chatInstanceStorageKey } from './useChatInstance';
jest.mock('./chat/useSocketHandler', () => ({ useSocketHandler: jest.fn(() => ({ current: null })) }));

const request = jest.fn();
const oldFetch = global.fetch;
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data, clone() { return this; } });
const welcomeBody = {
  starters: [{ icon: 'wave', title: 'Hours', description: 'Opening hours', message: 'When are you open?' }, { title: 42, message: 'invalid' }, null],
  suggestions: ['Shipping?', 7, 'Returns?'],
};
const calls = (fragment: string) => request.mock.calls.filter(call => String(call[0]).includes(fragment));
const config = { apiUrl: 'http://core.test', apiToken: 'app-token', lazyConversation: true };
const user = { id: 'anonymous', email: 'anonymous@example.com' };

beforeEach(() => {
  sessionStorage.clear();
  const data = new Map<string, string>();
  (localStorage.getItem as jest.Mock).mockImplementation((k: string) => data.get(k) ?? null);
  (localStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => data.set(k, v));
  (localStorage.removeItem as jest.Mock).mockImplementation((k: string) => data.delete(k));
  request.mockReset().mockImplementation(async (url: string, options: any = {}) => {
    if (url.includes('/welcome')) return json(welcomeBody);
    if (url.endsWith('/api/chat/createInstance')) {
      const body = JSON.parse(options.body);
      return json({ chatInstanceId: body.chatInstanceId || 'created' });
    }
    if (url.endsWith('/api/chat')) return json({});
    return json([]);
  });
  global.fetch = request;
});
afterEach(() => { global.fetch = oldFetch; });

it('exposes welcome starters and suggestions without creating a conversation', async () => {
  const hook = renderHook(() => useChatMessages({ chatModelId: 'model/1', user, setUser: jest.fn(), config, lang: 'fr' }));
  await waitFor(() => expect(hook.result.current.conversationStarters).toHaveLength(1));
  expect(calls('createInstance')).toHaveLength(0);
  expect(hook.result.current.chatInstanceId).toBe('');
  expect(hook.result.current.isLoading).toBe(false);
  const [welcome] = calls('/welcome');
  expect(welcome[0]).toBe('http://core.test/api/public/chatModel/model%2F1/welcome?lang=fr');
  expect(welcome[1].headers).toEqual({ appToken: 'app-token' });
  expect(hook.result.current.conversationStarters[0]).toEqual(welcomeBody.starters[0]);
  expect(hook.result.current.suggestions).toEqual(['Shipping?', 'Returns?']);
  hook.unmount();
});

it('refetches welcome content when the language changes and ignores failures', async () => {
  const hook = renderHook(({ lang }) => useChatMessages({ chatModelId: 'model', user, setUser: jest.fn(), config, lang }), { initialProps: { lang: 'fr' } });
  await waitFor(() => expect(hook.result.current.suggestions).toHaveLength(2));
  request.mockImplementation(async () => { throw new Error('offline'); });
  hook.rerender({ lang: 'en' });
  await act(async () => {});
  expect(calls('/welcome').map(call => call[0])).toEqual([
    'http://core.test/api/public/chatModel/model/welcome?lang=fr',
    'http://core.test/api/public/chatModel/model/welcome?lang=en',
  ]);
  expect(hook.result.current.suggestions).toEqual([]);
  expect(hook.result.current.conversationStarters).toEqual([]);
  hook.unmount();
});

it('resumes a saved conversation and does not fetch welcome content for it', async () => {
  localStorage.setItem(chatInstanceStorageKey('http://core.test', 'model', user, false, ''), 'saved');
  const hook = renderHook(() => useChatMessages({ chatModelId: 'model', user, setUser: jest.fn(), config, lang: 'fr' }));
  await waitFor(() => expect(hook.result.current.chatInstanceId).toBe('saved'));
  expect(JSON.parse(calls('createInstance')[0][1].body)).toMatchObject({ resumeOnly: true, chatInstanceId: 'saved' });
  await act(async () => {});
  expect(calls('/welcome')).toHaveLength(0);
  hook.unmount();
});

it('creates the conversation on first send and sends the message into it exactly once', async () => {
  const hook = renderHook(() => useChatMessages({ chatModelId: 'model', user, setUser: jest.fn(), config, lang: 'fr' }));
  await act(async () => {});
  expect(calls('createInstance')).toHaveLength(0);
  await act(async () => { hook.result.current.onSend('Hello'); hook.result.current.onSend('Hello again'); });
  await waitFor(() => expect(calls('/api/chat').filter(call => call[0] === 'http://core.test/api/chat')).toHaveLength(1));
  expect(calls('createInstance')).toHaveLength(1);
  const sent = calls('/api/chat').find(call => call[0] === 'http://core.test/api/chat')!;
  expect(JSON.parse(sent[1].body)).toMatchObject({ message: 'Hello', chatInstanceId: 'created' });
  expect(hook.result.current.chatInstanceId).toBe('created');
  await act(async () => {});
  expect(calls('/api/chat').filter(call => call[0] === 'http://core.test/api/chat')).toHaveLength(1);
  hook.unmount();
});

it('drops a queued message when creation fails', async () => {
  request.mockImplementation(async (url: string) => url.includes('createInstance') ? json({ code: 'RATE_LIMITED' }, 429) : json({ starters: [], suggestions: [] }));
  const hook = renderHook(() => useChatMessages({ chatModelId: 'model', user, setUser: jest.fn(), config, lang: 'fr' }));
  await act(async () => {});
  await act(async () => { hook.result.current.onSend('Hello'); });
  await waitFor(() => expect(hook.result.current.instanceError).toBeInstanceOf(Error));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  expect(calls('/api/chat').filter(call => call[0] === 'http://core.test/api/chat')).toHaveLength(0);
  hook.unmount();
});

it('createNewChat in lazy mode clears the conversation without a request', async () => {
  const hook = renderHook(() => useChatMessages({ chatModelId: 'model', user, setUser: jest.fn(), config, lang: 'fr' }));
  await act(async () => {});
  await act(async () => { await hook.result.current.ensureChatInstance(); });
  expect(hook.result.current.chatInstanceId).toBe('created');
  const creations = calls('createInstance').length;
  await act(async () => { expect(await hook.result.current.createNewChat()).toBeNull(); });
  expect(calls('createInstance')).toHaveLength(creations);
  expect(hook.result.current.chatInstanceId).toBe('');
  expect(hook.result.current.messages).toEqual([]);
  hook.unmount();
});

it('non-lazy: never fetches welcome content', async () => {
  const hook = renderHook(() => useChatMessages({ chatModelId: 'model', user, setUser: jest.fn(), config: { apiUrl: 'http://core.test' }, lang: 'fr' }));
  await waitFor(() => expect(hook.result.current.chatInstanceId).toBe('created'));
  expect(calls('/welcome')).toHaveLength(0);
  hook.unmount();
});
