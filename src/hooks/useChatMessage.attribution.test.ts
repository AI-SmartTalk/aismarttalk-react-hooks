import { act, renderHook } from '@testing-library/react';
import { useChatMessages } from './useChatMessage';
import { useConversationSync } from './chat/useConversationSync';
import { User } from '../types/users';
import { FrontChatMessage } from '../types/chat';

jest.mock('./useChatInstance', () => ({ __esModule: true, default: () => ({
  chatInstanceId: 'claimed-conversation', storageKey: 'attribution-test',
}) }));
jest.mock('./chat/useConversationSync', () => ({ useConversationSync: jest.fn(() => jest.fn()) }));
jest.mock('./chat/useSocketHandler', () => ({ useSocketHandler: () => ({ current: null }) }));
jest.mock('../utils/restoreScopedChatHistory', () => ({ restoreScopedChatHistory: async () => [] }));

it('keeps guest and connected messages on the sent side after login and history reload, without changing authors', async () => {
  jest.useFakeTimers();
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
  rerender({ user: account });
  const messages = [row('guest-message', guest), row('bot-reply', bot), row('account-message', account), row('agent-message', account, { sentAsAgent: true }), row('other-account-message', { id: 'bob', email: 'bob@example.test', name: 'Bob', role: 'CONNECTED_USER' })];
  await act(async () => history()({ connectedOrAnonymousUser: guest, messages }));
  expect(Object.fromEntries(result.current.messages.map(m => [m.id, m.isSent]))).toEqual({ 'guest-message': true, 'bot-reply': false, 'account-message': true, 'agent-message': false, 'other-account-message': false });
  expect(result.current.messages.find(m => m.id === 'guest-message')?.user).toEqual(guest);
  expect(result.current.messages.find(m => m.id === 'account-message')?.user).toEqual(account);
  unmount();
  jest.clearAllTimers();
  jest.useRealTimers();
});
