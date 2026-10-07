import { act, renderHook } from '@testing-library/react';
import { useSocketHandler } from './chat/useSocketHandler';
import { useChatMessages } from './useChatMessage';
import { useConversationSync } from './chat/useConversationSync';
import { User } from '../types/users';
import { FrontChatMessage } from '../types/chat';

jest.mock('./useChatInstance', () => ({ __esModule: true, default: ({ user }: any) => ({
  chatInstanceId: 'claimed-conversation', storageKey: `attribution-test:${user.id}`,
}) }));
jest.mock('./chat/useConversationSync', () => ({ useConversationSync: jest.fn(() => jest.fn()) }));
jest.mock('./chat/useSocketHandler', () => ({ useSocketHandler: jest.fn(() => ({ current: null })) }));
jest.mock('../utils/restoreScopedChatHistory', () => ({ restoreScopedChatHistory: async () => [] }));

it('keeps guest and connected messages on the sent side after login and history reload, without changing authors', async () => {
  jest.useFakeTimers();
  const storage = new Map<string, string>();
  (localStorage.getItem as jest.Mock).mockImplementation((key: string) => storage.get(key) ?? null);
  (localStorage.setItem as jest.Mock).mockImplementation((key: string, value: string) => storage.set(key, value));
  (localStorage.removeItem as jest.Mock).mockImplementation((key: string) => storage.delete(key));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
  const guest = { id: 'sys_anonymous', email: 'visitor@example.test', name: 'Visitor', role: 'ANONYMOUS' };
  const account = { id: 'alice', email: 'alice@example.test', name: 'Alice', token: 'token' };
  const bot = { id: 'bot', email: 'bot@example.test', name: 'Bot', role: 'BOT' };
  const row = (id: string, user: any, metadata?: Record<string, any>): FrontChatMessage => ({
    id, user, metadata, text: id, isSent: false, chatInstanceId: 'claimed-conversation',
    created_at: '2026-10-07T11:40:00Z', updated_at: '2026-10-07T11:40:00Z',
  });
  const { result, rerender, unmount } = renderHook(({ user }) => useChatMessages({
    chatModelId: 'model', user, setUser: jest.fn(), config: { apiUrl: 'http://api.test' },
  }), { initialProps: { user: guest as User } });
  const history = () => (useConversationSync as jest.Mock).mock.calls.at(-1)[0].onHistory;
  await act(async () => history()({ connectedOrAnonymousUser: guest, messages: [row('guest-message', guest), row('bot-reply', bot)] }));
  expect(Object.fromEntries(result.current.messages.map(m => [m.id, m.isSent]))).toEqual({ 'guest-message': true, 'bot-reply': false });
  expect(result.current.conversations).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('chat-conversations:attribution-test:sys_anonymous')!)[0].id).toBe('claimed-conversation');
  rerender({ user: account });
  const messages = [row('guest-message', guest), row('bot-reply', bot), row('account-message', account), row('agent-message', account, { sentAsAgent: true }), row('other-account-message', { id: 'bob', email: 'bob@example.test', name: 'Bob', role: 'CONNECTED_USER' })];
  await act(async () => history()({ connectedOrAnonymousUser: guest, messages }));
  expect(Object.fromEntries(result.current.messages.map(m => [m.id, m.isSent]))).toEqual({ 'guest-message': true, 'bot-reply': false, 'account-message': true, 'agent-message': false, 'other-account-message': false });
  expect(result.current.messages.find(m => m.id === 'guest-message')?.user).toEqual(guest);
  expect(result.current.messages.find(m => m.id === 'account-message')?.user).toEqual(account);
  expect(result.current.conversations).toHaveLength(1);
  expect(result.current.conversations[0].messages).toHaveLength(messages.length);
  expect(JSON.parse(localStorage.getItem('chat-conversations:attribution-test:alice')!)[0].messages).toHaveLength(messages.length);
  unmount();
  const restored = renderHook(() => useChatMessages({ chatModelId: 'model', user: account, setUser: jest.fn(), config: { apiUrl: 'http://api.test' } }));
  await act(async () => {});
  expect(restored.result.current.conversations).toHaveLength(1);
  expect(restored.result.current.conversations[0].id).toBe('claimed-conversation');
  restored.unmount();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('fans out voice events on the admitted SDK connection and unsubscribes cleanly', async () => {
 global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>[]});
 const {result,unmount}=renderHook(()=>useChatMessages({chatModelId:'model',user:{id:'alice',email:'alice@test',token:'token'},setUser:jest.fn()}));
 const onEvent=(useSocketHandler as jest.Mock).mock.calls.at(-1)[16];
 const first=jest.fn(),second=jest.fn();
 const stopFirst=result.current.subscribeToConversationEvent('voice-processing-step',first);
 const stopSecond=result.current.subscribeToConversationEvent('voice-processing-step',second);
 act(()=>onEvent('voice-processing-step',{step:'thinking'}));expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(1);
 stopFirst();act(()=>onEvent('voice-processing-step',{step:'tool'}));expect(first).toHaveBeenCalledTimes(1);expect(second).toHaveBeenCalledTimes(2);
 stopSecond();act(()=>onEvent('voice-processing-step',{step:'thinking'}));expect(second).toHaveBeenCalledTimes(2);
 unmount();await act(async()=>{});
});
