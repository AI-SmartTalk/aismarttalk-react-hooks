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

it('shows scoped history while legacy admission is still pending', async () => {
  (localStorage.getItem as jest.Mock).mockImplementation(key => key === 'chat-conversations:scope' ? '[{"id":"already-owned"}]' : '[{"id":"legacy"}]');
  let finish!: (data: any) => void;
  global.fetch = jest.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const progress = jest.fn();
  const pending = restoreScopedChatHistory({ storageKey: 'scope', modelId: 'model', apiUrl: 'http://core.test', signal: new AbortController().signal, onProgress: progress });
  expect(progress).toHaveBeenCalledWith([{ id: 'already-owned' }]);
  finish({ ok: false });
  await pending;
});
