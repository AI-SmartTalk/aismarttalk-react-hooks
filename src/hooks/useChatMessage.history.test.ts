import { act, renderHook } from '@testing-library/react';
import { useChatMessages } from './useChatMessage';
import { restoreScopedChatHistory } from '../utils/restoreScopedChatHistory';
import { persistScopedChatHistory } from '../utils/persistScopedChatHistory';
let mockId = 'selected';
jest.mock('./useChatInstance', () => ({ __esModule: true, default: ({ user }: any) => ({
  getNewInstance: async () => 'fresh', chatInstanceId: mockId, storageKey: `history:${user.id}`,
}) }));
jest.mock('./chat/useConversationSync', () => ({ useConversationSync: jest.fn(() => jest.fn()) }));
jest.mock('./chat/useSocketHandler', () => ({ useSocketHandler: jest.fn(() => ({ current: null })) }));
jest.mock('../utils/restoreScopedChatHistory', () => ({ restoreScopedChatHistory: jest.fn(async () => []) }));

beforeEach(() => {
  jest.clearAllMocks(); mockId = 'selected';
  const storage = new Map<string, string>();
  (localStorage.getItem as jest.Mock).mockImplementation(key => storage.get(key) ?? null);
  (localStorage.setItem as jest.Mock).mockImplementation((key, value) => storage.set(key, value));
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
});
it('only restores local history on request, without scanning again on conversation changes', async () => {
  const hook = renderHook(({ token }) => useChatMessages({ chatModelId:'model', user:{id:'visitor',email:'visitor@example.test',token}, setUser:jest.fn() }), { initialProps:{token:'first'} });
  await act(async () => {});
  expect(restoreScopedChatHistory).not.toHaveBeenCalled();
  mockId = 'next'; hook.rerender({token:'first'});
  await act(async () => {});
  expect(restoreScopedChatHistory).not.toHaveBeenCalled();
  await act(async () => hook.result.current.loadLocalConversationHistory());
  expect(restoreScopedChatHistory).toHaveBeenCalledTimes(1);
  mockId = 'third'; hook.rerender({token:'first'});
  await act(async () => hook.result.current.loadLocalConversationHistory());
  expect(restoreScopedChatHistory).toHaveBeenCalledTimes(1);
  hook.rerender({token:'renewed'});
  await act(async () => {});
  expect(hook.result.current.conversations).toEqual([]);
  await act(async () => hook.result.current.loadLocalConversationHistory());
  expect(restoreScopedChatHistory).toHaveBeenCalledTimes(2);
  hook.unmount();
});
it('preserves unopened cached history without exposing it in the conversation list', async () => {
  const old = {id:'old',title:'Old',messages:[],lastUpdated:'2026-10-13'};
  persistScopedChatHistory('history:visitor', [old]);
  const hook = renderHook(() => useChatMessages({chatModelId:'model',user:{id:'visitor',email:'visitor@example.test'},setUser:jest.fn()}));
  await act(async () => hook.result.current.createNewChat());
  expect(hook.result.current.conversations.map(item => item.id)).toEqual(['fresh']);
  expect(JSON.parse(localStorage.getItem('chat-conversations:history:visitor')!).map((item:any) => item.id)).toEqual(['fresh','old']);
  hook.unmount();
});
