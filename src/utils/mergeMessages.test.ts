import { mergeMessages } from './mergeMessages';
import { FrontChatMessage } from '../types/chat';
import { chatReducer, ChatActionTypes, initialChatState } from '../reducers/chatReducers';
const message = (id: string, overrides: Partial<FrontChatMessage> = {}): FrontChatMessage => ({
  id, text: 'Bonjour', isSent: false, chatInstanceId: 'chat', created_at: '2026-09-30T10:00:00Z',
  updated_at: '2026-09-30T10:00:00Z', user: { id: 'agent', name: 'Agent', email: 'agent@example.com' }, ...overrides,
});
describe('message reconciliation', () => {
  it('merges socket and HTTP messages by their persisted ID', () => {
    expect(mergeMessages([message('1')], [message('1')])).toHaveLength(1);
  });
  it('keeps identical legitimate replies with distinct IDs', () => {
    expect(mergeMessages([message('1')], [message('2')])).toHaveLength(2);
  });
  it('replaces optimistic messages one-for-one', () => {
    expect(mergeMessages([message('temp-1', { isLocallyCreated: true }), message('temp-2', { isLocallyCreated: true, created_at: '2026-09-30T10:00:02Z' })], [message('1')]).map(m => m.id)).toEqual(['1', 'temp-2']);
  });
  it('keeps a newer socket edit when an older HTTP snapshot arrives', () => {
    expect(mergeMessages([message('1', { text: 'Edited', updated_at: '2026-09-30T10:01:00Z' })], [message('1')])[0].text).toBe('Edited');
  });
  it('preserves attachments and the human-agent marker when replayed', () => {
    expect(mergeMessages([message('1', { metadata: { sentAsAgent: true, imageMetadata: {} } })], [message('1')])[0].metadata).toEqual({ sentAsAgent: true, imageMetadata: {} });
  });
  it('reconciles SSE fallback and persisted answer without duplicate display', () => {
    expect(mergeMessages([message('streaming-fallback-1', { user: undefined })], [message('1')])).toHaveLength(1);
  });
  it('keeps a human reply incoming even when the agent shares the visitor account', () => {
    const state = chatReducer(initialChatState, { type: ChatActionTypes.ADD_MESSAGE, payload: {
      chatInstanceId: 'chat', userId: 'agent', message: message('1', { isSent: true, metadata: { sentAsAgent: true } }),
    } });
    expect(state.messages[0].isSent).toBe(false);
  });
});
