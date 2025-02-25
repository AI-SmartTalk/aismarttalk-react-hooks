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
  
  // This test is skipped because TypeScript types are not present at runtime
  it.skip('should export type declarations in TypeScript', () => {
    // This test would normally fail in Jest because types
    // are removed during transpilation and don't exist at runtime.
    // We're skipping it since it's a compile-time check, not runtime.
    
    // TypeScript types that should be exported:
    // - User
    // - FrontChatMessage
    // - CTADTO
    // - TypingUser
    // - Tool
    // - ChatModel
    // - ChatConfig
    // - UseChatMessagesOptions
    // - ChatHistoryItem
  });
  
  it('should have the correct number of exports', () => {
    // Just the 4 hook functions should be exported as runtime values
    expect(Object.keys(indexExports).length).toBe(4);
  });
}); 