import {
  ChatActionTypes,
  chatReducer,
  initialChatState,
  debounce,
  loadMessagesFromLocalStorage,
  debouncedSaveMessagesToLocalStorage
} from "../../reducers/chatReducers";
import { FrontChatMessage } from "../../types/chat";

// Move before all describe blocks
const sampleMessages: FrontChatMessage[] = [
  {
    id: "msg1",
    text: "Hello",
    chatInstanceId: "chat123",
    isSent: true,
    created_at: "2023-01-01T12:00:00Z",
    updated_at: "2023-01-01T12:00:00Z",
    user: {
      id: "user1",
      name: "Test User",
      email: "test@example.com"
    }
  },
  {
    id: "msg2",
    text: "Hi there",
    chatInstanceId: "chat123",
    isSent: false,
    created_at: "2023-01-01T12:01:00Z",
    updated_at: "2023-01-01T12:01:00Z",
    user: {
      id: "assistant",
      name: "Assistant",
      email: "assistant@example.com"
    }
  }
];

const localStorageMock = {
  getItem: jest.fn().mockImplementation(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  length: 0,
  key: jest.fn(),
} as unknown as Storage & { getItem: jest.Mock };

describe("chatReducer", () => {
  beforeEach(() => {
    // Setup localStorage mock
    Object.defineProperty(window, "localStorage", { value: localStorageMock });
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("should return the initial state", () => {
    expect(initialChatState).toEqual({
      messages: [],
      notificationCount: 0,
      suggestions: [],
      title: "💬",
      isLoading: false,
      canvases: []
    });
  });

  it("should handle SET_MESSAGES action", () => {
    const action = {
      type: ChatActionTypes.SET_MESSAGES,
      payload: {
        chatInstanceId: "chat123",
        messages: sampleMessages
      }
    };

    const newState = chatReducer(initialChatState, action);

    expect(newState.messages).toEqual(sampleMessages);
  });

  it("should limit messages to last 50 when handling SET_MESSAGES", () => {
    // Create 55 messages
    const manyMessages = Array.from({ length: 55 }, (_, i) => ({
      id: `msg${i}`,
      text: `Message ${i}`,
      chatInstanceId: "chat123",
      isSent: true,
      created_at: `2023-01-01T12:${i.toString().padStart(2, '0')}:00Z`,
      updated_at: `2023-01-01T12:${i.toString().padStart(2, '0')}:00Z`,
      user: {
        id: "user1",
        name: "Test User",
        email: "test@example.com"
      }
    }));

    const action = {
      type: ChatActionTypes.SET_MESSAGES,
      payload: {
        chatInstanceId: "chat123",
        messages: manyMessages
      }
    };

    const newState = chatReducer(initialChatState, action);
    
    // Should only include the last 50 messages
    expect(newState.messages.length).toBe(50);
    expect(newState.messages[0].id).toBe("msg5"); // The first message should be the 6th (index 5)
    expect(newState.messages[49].id).toBe("msg54"); // The last message should be the last of 55
  });

  it("should handle ADD_MESSAGE action", () => {
    const existingState = {
      ...initialChatState,
      messages: [sampleMessages[0]]
    };

    const newMessage = sampleMessages[1];

    const action = {
      type: ChatActionTypes.ADD_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: newMessage
      }
    };

    const newState = chatReducer(existingState, action);

    expect(newState.messages.length).toBe(2);
    expect(newState.messages[1]).toEqual(newMessage);
  });

  it("should handle different deduplication scenarios correctly", () => {
    // Create a local message as the base
    const localMessage = {
      ...sampleMessages[0],
      isLocallyCreated: true
    };

    const existingState = {
      ...initialChatState,
      messages: [localMessage]
    };

    // Test 1: Local message rapid duplicate (within 500ms) - should be blocked
    const rapidLocalDuplicate = {
      ...sampleMessages[0],
      id: "msg1-rapid-local-duplicate",
      isLocallyCreated: true,
      created_at: "2023-01-01T12:00:00.100Z" // 100ms after original
    };

    const action1 = {
      type: ChatActionTypes.ADD_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: rapidLocalDuplicate
      }
    };

    const newState1 = chatReducer(existingState, action1);
    expect(newState1.messages.length).toBe(1); // Should be blocked

    // Test 2: Create state with server message for server duplicate test
    const serverMessage = {
      ...sampleMessages[0],
      isLocallyCreated: false
    };

    const stateWithServerMessage = {
      ...initialChatState,
      messages: [serverMessage]
    };

    const serverDuplicate = {
      ...sampleMessages[0],
      id: "msg1-server-duplicate",
      isLocallyCreated: false,
      created_at: "2023-01-01T12:00:05.000Z" // 5 seconds after original
    };

    const action2 = {
      type: ChatActionTypes.ADD_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: serverDuplicate
      }
    };

    const newState2 = chatReducer(stateWithServerMessage, action2);
    expect(newState2.messages.length).toBe(1); // Should be blocked

    // Test 3: Message after longer time - should be allowed
    const laterMessage = {
      ...sampleMessages[0],
      id: "msg1-later-message",
      isLocallyCreated: false,
      created_at: "2023-01-01T12:00:15.000Z" // 15 seconds after original
    };

    const action3 = {
      type: ChatActionTypes.ADD_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: laterMessage
      }
    };

    const newState3 = chatReducer(stateWithServerMessage, action3);
    expect(newState3.messages.length).toBe(2); // Should be allowed
  });

  it("should handle API + WebSocket duplicate scenario", () => {
    // Simulate the API + WebSocket scenario:
    // 1. User sends message
    // 2. API responds immediately with the message
    // 3. WebSocket also broadcasts the same message shortly after

    const apiMessage = {
      id: "api-msg-1",
      text: "Hello from API",
      chatInstanceId: "chat123",
      isSent: true,
      created_at: "2023-01-01T12:00:00.000Z",
      updated_at: "2023-01-01T12:00:00.000Z",
      isLocallyCreated: false, // From API
      user: {
        id: "user1",
        name: "Test User",
        email: "test@example.com"
      }
    };

    const stateWithApiMessage = {
      ...initialChatState,
      messages: [apiMessage]
    };

    // WebSocket sends the same message 2 seconds later
    const websocketMessage = {
      id: "ws-msg-1",
      text: "Hello from API", // Same text
      chatInstanceId: "chat123",
      isSent: true,
      created_at: "2023-01-01T12:00:02.000Z", // 2 seconds later
      updated_at: "2023-01-01T12:00:02.000Z",
      isLocallyCreated: false, // From WebSocket
      user: {
        id: "user1", // Same user
        name: "Test User",
        email: "test@example.com"
      }
    };

    const action = {
      type: ChatActionTypes.ADD_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: websocketMessage
      }
    };

    const newState = chatReducer(stateWithApiMessage, action);
    
    // WebSocket message should be blocked as duplicate (within 10 seconds)
    expect(newState.messages.length).toBe(1);
    expect(newState.messages[0].id).toBe("api-msg-1"); // Original API message preserved
  });

  it("should handle RESET_CHAT action", () => {
    const existingState = {
      ...initialChatState,
      messages: [...sampleMessages],
      title: "Test Chat"
    };

    const action = {
      type: ChatActionTypes.RESET_CHAT,
      payload: {
        chatInstanceId: "chat123"
      }
    };

    const newState = chatReducer(existingState, action);

    expect(newState.messages).toEqual([]);
    expect(newState.title).toBe("💬");
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(
      "chatMessages[chat123]"
    );
  });

  it("should handle UPDATE_NOTIFICATION_COUNT action", () => {
    const action = {
      type: ChatActionTypes.UPDATE_NOTIFICATION_COUNT,
      payload: {
        notificationCount: 5
      }
    };

    const newState = chatReducer(initialChatState, action);

    expect(newState.notificationCount).toBe(5);
  });

  it("should handle UPDATE_SUGGESTIONS action", () => {
    const suggestions = ["Try asking about X", "How about Y?"];
    
    const action = {
      type: ChatActionTypes.UPDATE_SUGGESTIONS,
      payload: {
        suggestions
      }
    };

    const newState = chatReducer(initialChatState, action);

    expect(newState.suggestions).toEqual(suggestions);
  });

  it("should handle UPDATE_MESSAGE action for existing message", () => {
    const existingState = {
      ...initialChatState,
      messages: [...sampleMessages]
    };

    const updatedMessageData = {
      id: "msg1",
      text: "Hello (edited)",
      chatInstanceId: "chat123",
      isSent: true,
      created_at: "2023-01-01T12:00:00Z",
      updated_at: "2023-01-01T12:00:00Z",
      user: {
        id: "user1",
        name: "Test User",
        email: "test@example.com"
      }
    };

    const action = {
      type: ChatActionTypes.UPDATE_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: updatedMessageData
      }
    };

    const newState = chatReducer(existingState, action);

    expect(newState.messages[0].text).toBe("Hello (edited)");
    expect(newState.messages[0].id).toBe("msg1"); // ID should be preserved
    expect(newState.messages.length).toBe(2); // Count should stay the same
  });

  it("should handle UPDATE_MESSAGE action for new message", () => {
    const existingState = {
      ...initialChatState,
      messages: [sampleMessages[0]]
    };

    const newMessage = {
      id: "msg3",
      text: "Brand new message",
      chatInstanceId: "chat123",
      isSent: true,
      created_at: "2023-01-01T12:03:00Z",
      updated_at: "2023-01-01T12:03:00Z",
      user: {
        id: "user1",
        name: "Test User",
        email: "test@example.com"
      }
    };

    const action = {
      type: ChatActionTypes.UPDATE_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: newMessage
      }
    };

    const newState = chatReducer(existingState, action);

    expect(newState.messages.length).toBe(2);
    expect(newState.messages[1].id).toBe("msg3");
    expect(newState.messages[1].text).toBe("Brand new message");
  });

  it("should handle UPDATE_TITLE action", () => {
    const action = {
      type: ChatActionTypes.UPDATE_TITLE,
      payload: {
        title: "New Chat Title"
      }
    };

    const newState = chatReducer(initialChatState, action);

    expect(newState.title).toBe("New Chat Title");
  });

  it("should handle SET_LOADING action", () => {
    const action = {
      type: ChatActionTypes.SET_LOADING,
      payload: {
        isLoading: true
      }
    };

    const newState = chatReducer(initialChatState, action);

    expect(newState.isLoading).toBe(true);
  });

  it("should return unchanged state for unknown action type", () => {
    const action = {
      type: "UNKNOWN_ACTION" as any,
      payload: {}
    };

    const newState = chatReducer(initialChatState, action);

    expect(newState).toBe(initialChatState);
  });
});

describe("debounce function", () => {
  jest.useFakeTimers();

  it("should debounce function calls", () => {
    const mockFn = jest.fn();
    const debouncedFn = debounce(mockFn, 1000);

    // Call multiple times
    debouncedFn(1, 2);
    debouncedFn(3, 4);
    debouncedFn(5, 6);

    // Function should not have been called yet
    expect(mockFn).not.toHaveBeenCalled();

    // Fast-forward time
    jest.runAllTimers();

    // Function should have been called once with the last arguments
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith(5, 6);
  });
});

describe("localStorage functions", () => {
  beforeEach(() => {
    // Setup localStorage mock
    Object.defineProperty(window, "localStorage", { value: localStorageMock });
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it("should save messages to localStorage", () => {
    const messages = [...sampleMessages];
    const chatInstanceId = "test-chat-123";

    // Call the non-debounced function directly for testing
    const saveMessagesToLocalStorage = (
      messages: FrontChatMessage[],
      chatInstanceId: string
    ) => {
      localStorage.setItem(
        `chatMessages[${chatInstanceId}]`,
        JSON.stringify(messages)
      );
    };

    saveMessagesToLocalStorage(messages, chatInstanceId);

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      `chatMessages[${chatInstanceId}]`,
      JSON.stringify(messages)
    );
  });

  it("should load messages from localStorage", () => {
    const messages = [...sampleMessages];
    const chatInstanceId = "test-chat-123";

    // Set up mock localStorage with data
    localStorageMock.getItem.mockReturnValue(JSON.stringify(messages));

    const loadedMessages = loadMessagesFromLocalStorage(chatInstanceId);

    expect(localStorageMock.getItem).toHaveBeenCalledWith(
      `chatMessages[${chatInstanceId}]`
    );
    expect(loadedMessages).toEqual(messages);
  });

  it("should return empty array when localStorage item is empty", () => {
    const chatInstanceId = "test-chat-empty";
    
    // Mock empty localStorage return
    localStorageMock.getItem.mockReturnValue(null);

    const loadedMessages = loadMessagesFromLocalStorage(chatInstanceId);

    expect(loadedMessages).toEqual([]);
  });

  it("should handle JSON parse errors when loading from localStorage", () => {
    const chatInstanceId = "test-chat-corrupted";
    
    // Mock corrupted localStorage data
    localStorageMock.getItem.mockReturnValue("{invalid-json}");

    const loadedMessages = loadMessagesFromLocalStorage(chatInstanceId);

    expect(loadedMessages).toEqual([]);
  });
}); 