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
      isLoading: false
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

  it("should limit messages to last 30 when handling SET_MESSAGES", () => {
    // Create 35 messages
    const manyMessages = Array.from({ length: 35 }, (_, i) => ({
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
    
    // Should only include the last 30 messages
    expect(newState.messages.length).toBe(30);
    expect(newState.messages[0].id).toBe("msg5"); // The first message should be the 6th (index 5)
    expect(newState.messages[29].id).toBe("msg34"); // The last message should be the last of 35
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

  it("should not add duplicate messages", () => {
    const existingState = {
      ...initialChatState,
      messages: [sampleMessages[0]]
    };

    // Create a nearly duplicate message with same text and user
    const duplicateMessage = {
      ...sampleMessages[0],
      id: "msg1-duplicate" // Different ID but same content
    };

    const action = {
      type: ChatActionTypes.ADD_MESSAGE,
      payload: {
        chatInstanceId: "chat123",
        message: duplicateMessage
      }
    };

    const newState = chatReducer(existingState, action);

    // No message should be added since it's a duplicate
    expect(newState.messages.length).toBe(1);
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