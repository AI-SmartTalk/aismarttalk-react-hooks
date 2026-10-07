import * as indexExports from '../index';

describe('index barrel exports', () => {
  it('should export useChatMessages hook', () => {
    expect(indexExports.useChatMessages).toBeDefined();
    expect(typeof indexExports.useChatMessages).toBe('function');
  });

  it('should export useChatInstance hook', () => {
    expect(indexExports.useChatInstance).toBeDefined();
    expect(typeof indexExports.useChatInstance).toBe('function');
  });

  it('should export useAISmarttalkChat hook', () => {
    expect(indexExports.useAISmarttalkChat).toBeDefined();
    expect(typeof indexExports.useAISmarttalkChat).toBe('function');
  });

  it('should export useUser hook', () => {
    expect(indexExports.useUser).toBeDefined();
    expect(typeof indexExports.useUser).toBe('function');
  });
  
  it('exposes the supported runtime API', () => {
    const hooks = ['useChatMessages', 'useChatInstance', 'useAISmarttalkChat', 'useUser',
      'useChatModel', 'useOtpAuth', 'useFileUpload', 'useSocketHandler'];
    for (const name of hooks) expect(typeof (indexExports as any)[name]).toBe('function');
    expect(indexExports.ChatActionTypes).toBeDefined();
    expect(typeof indexExports.chatReducer).toBe('function');
    expect(indexExports.initialChatState).toBeDefined();
    expect(Object.keys(indexExports).sort()).toEqual([...hooks, 'conversationVisitorHeaders', 'reportConversationAccessFailure', 'ChatActionTypes', 'chatReducer', 'initialChatState'].sort());
  });
});
