import { restoreScopedChatHistory } from './restoreScopedChatHistory';
const oldFetch = global.fetch;
afterEach(() => { global.fetch = oldFetch; });
it('preserves admitted legacy conversations without trusting cached owner labels', async () => {
  const map = new Map<string, string>([['chat-conversations-model', JSON.stringify([{ id: 'owned' }, { id: 'other-account', user: { id: 'me' } }])]]);
  (localStorage.getItem as jest.Mock).mockImplementation(key => map.get(key) || null);
  (localStorage.setItem as jest.Mock).mockImplementation((key, value) => map.set(key, value));
  global.fetch = jest.fn(async (_url, options) => ({ ok: JSON.parse(options!.body as string).chatInstanceId === 'owned', json: async () => ({ chatInstanceId: 'owned' }) } as Response));
  const result = await restoreScopedChatHistory({ storageKey: 'scope', modelId: 'model', apiUrl: 'http://core.test', signal: new AbortController().signal });
  expect(result).toEqual([{ id: 'owned' }]);
  expect(JSON.parse(map.get('chat-conversations:scope')!)).toEqual(result);
  expect(map.has('chat-conversations-model')).toBe(true);
});
it('does not expose legacy content when access cannot be verified', async () => {
  (localStorage.getItem as jest.Mock).mockImplementation(key => key === 'chat-conversations-model' ? '[{"id":"unverified"}]' : null);
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  expect(await restoreScopedChatHistory({ storageKey: 'scope', modelId: 'model', apiUrl: 'http://core.test', signal: new AbortController().signal })).toEqual([]);
});

it('never exposes scoped cached content before admission, including a claimed guest conversation', async () => {
  (localStorage.getItem as jest.Mock).mockImplementation(key => key === 'chat-conversations:scope' ? '[{"id":"guest"},{"id":"claimed","messages":[{"text":"private"}]}]' : null);
  const complete = new Map<string, Function>();
  global.fetch = jest.fn((_url, options) => new Promise(resolve => { complete.set(JSON.parse(options.body).chatInstanceId, resolve); })) as any;
  const progress = jest.fn();
  const pending = restoreScopedChatHistory({ storageKey: 'scope', modelId: 'model', apiUrl: 'http://core.test', signal: new AbortController().signal, onProgress: progress });
  expect(progress).not.toHaveBeenCalled();
  complete.get('guest')!({ ok: true, json: async () => ({ chatInstanceId: 'guest' }) });
  complete.get('claimed')!({ ok: false, status: 401 });
  expect(await pending).toEqual([{ id: 'guest' }]);
  expect(progress).toHaveBeenCalledWith([{ id: 'guest' }]);
});
