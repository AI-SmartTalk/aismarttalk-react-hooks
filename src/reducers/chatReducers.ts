import { FrontChatMessage } from "../types/chat";
import { shouldMessageBeSent } from "../utils/messageUtils";
import {
  saveConversationHistory,
  loadConversationHistory,
} from "../utils/localStorageHelpers";

export enum ChatActionTypes {
  SET_MESSAGES = "SET_MESSAGES",
  ADD_MESSAGE = "ADD_MESSAGE",
  RESET_CHAT = "RESET_CHAT",
  UPDATE_NOTIFICATION_COUNT = "UPDATE_NOTIFICATION_COUNT",
  UPDATE_SUGGESTIONS = "UPDATE_SUGGESTIONS",
  UPDATE_MESSAGE = "UPDATE_MESSAGE",
  UPDATE_TITLE = "UPDATE_TITLE",
  SET_LOADING = "SET_LOADING",
}

interface ChatState {
  messages: FrontChatMessage[];
  notificationCount: number;
  suggestions: string[];
  title: string;
  isLoading: boolean;
}

const saveMessagesToLocalStorage = (
  messages: FrontChatMessage[],
  chatInstanceId: string
) => {
  try {
    const history = loadConversationHistory(chatInstanceId);
    const title = history.title || "💬";

    saveConversationHistory(chatInstanceId, title, messages);
  } catch (error) {
    console.error(
      "[AI Smarttalk] Error saving messages to localStorage:",
      error
    );
    localStorage.setItem(
      `chatMessages[${chatInstanceId}]`,
      JSON.stringify(messages)
    );
  }
};

export const debouncedSaveMessagesToLocalStorage = debounce(
  saveMessagesToLocalStorage,
  500
);

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number
) {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: T) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

export const loadMessagesFromLocalStorage = (
  chatInstanceId: string
): FrontChatMessage[] => {
  const savedMessages = localStorage.getItem(`chatMessages[${chatInstanceId}]`);
  if (!savedMessages || savedMessages === "undefined") {
    return [];
  }
  try {
    const messages = JSON.parse(savedMessages);
    return messages;
  } catch (e) {
    return [];
  }
};

interface ChatAction {
  type: ChatActionTypes;
  payload: {
    messages?: FrontChatMessage[];
    message?: FrontChatMessage;
    chatInstanceId?: string;
    notificationCount?: number;
    suggestions?: string[];
    title?: string;
    userEmail?: string;
    userId?: string;
    isLoading?: boolean;
    resetMessages?: boolean;
  };
}

export const chatReducer = (
  state: ChatState,
  action: ChatAction
): ChatState => {
  switch (action.type) {
    case ChatActionTypes.SET_MESSAGES:
      if (!action.payload.chatInstanceId) return state;

      if (!action.payload.messages) {
        return state;
      }

      if (
        state.messages.length > 0 &&
        state.messages[0]?.chatInstanceId !== action.payload.chatInstanceId
      ) {
        if (action.payload.messages.length > 0) {
          debouncedSaveMessagesToLocalStorage(
            action.payload.messages,
            action.payload.chatInstanceId || ""
          );
          return { ...state, messages: action.payload.messages.slice(-50) };
        }

        return { ...state, messages: [] };
      }

      if (action.payload.resetMessages) {
        if (action.payload.messages.length === 0) {
          return { ...state, messages: [] };
        }

        debouncedSaveMessagesToLocalStorage(
          action.payload.messages,
          action.payload.chatInstanceId || ""
        );
        return { ...state, messages: action.payload.messages.slice(-50) };
      }

      if (action.payload.messages.length === 0 && state.messages.length > 0) {
        return state;
      }

      if (action.payload.userId) {
        action.payload.messages.forEach((msg) => {
          if (!msg.isSent) {
            msg.isSent = shouldMessageBeSent(
              msg,
              action.payload.userId,
              action.payload.userEmail
            );
          }
        });
      }

      if (state.messages.length > 0 && action.payload.messages?.length) {
        // Create a map of existing messages for faster lookup
        const existingMessages = new Map(
          state.messages.map((msg) => [msg.id, msg])
        );
        
        const newMessages = action.payload.messages;
        
        // Process regular messages from websocket
        newMessages.forEach((msg) => {
          if (!msg.id.startsWith("temp-")) {
            // Check if this message is an update to a temporary message
            const tempKey = Array.from(existingMessages.values()).find(
              existingMsg => 
                existingMsg.id.startsWith("temp-") && 
                existingMsg.text === msg.text &&
                existingMsg.user?.id === msg.user?.id
            );
            
            if (tempKey) {
              // If we found a matching temp message, remove it
              existingMessages.delete(tempKey.id);
            }
            
            // Add or update the websocket message
            existingMessages.set(msg.id, {
              ...msg,
              isSent: msg.isSent || (tempKey?.isSent || false)
            });
          } else {
            // For temp messages, only add if we don't already have a non-temp version
            let hasNonTempVersion = false;
            existingMessages.forEach((existingMsg) => {
              if (
                !existingMsg.id.startsWith("temp-") &&
                existingMsg.text === msg.text &&
                existingMsg.user?.id === msg.user?.id
              ) {
                hasNonTempVersion = true;
              }
            });
            
            if (!hasNonTempVersion && !existingMessages.has(msg.id)) {
              existingMessages.set(msg.id, msg);
            }
          }
        });

        const mergedMessages = Array.from(existingMessages.values()).sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        const limitedMessages = mergedMessages.slice(-50);
        debouncedSaveMessagesToLocalStorage(
          limitedMessages,
          action.payload.chatInstanceId || ""
        );

        return { ...state, messages: limitedMessages };
      }

      debouncedSaveMessagesToLocalStorage(
        action.payload.messages,
        action.payload.chatInstanceId || ""
      );

      return { ...state, messages: action.payload.messages.slice(-50) };

    case ChatActionTypes.ADD_MESSAGE:
      const newMessage = action.payload.message;
      if (!newMessage) return state;

      // Add the message directly without deduplication check
      newMessage.isSent = shouldMessageBeSent(
        newMessage,
        action.payload.userId,
        action.payload.userEmail
      );
      
      // Check if we're adding a normal message and we have a temp version
      if (!newMessage.id.startsWith("temp-")) {
        // Look for a temporary message that matches this one
        const tempIndex = state.messages.findIndex(
          msg => 
            msg.id.startsWith("temp-") &&
            msg.text === newMessage.text &&
            msg.user?.id === newMessage.user?.id
        );
        
        if (tempIndex >= 0) {
          // Replace the temp message with the permanent one
          const updatedMessages = [...state.messages];
          updatedMessages[tempIndex] = {
            ...newMessage,
            isSent: state.messages[tempIndex].isSent || newMessage.isSent
          };
          
          debouncedSaveMessagesToLocalStorage(
            updatedMessages,
            action.payload.chatInstanceId || ""
          );
          
          return { ...state, messages: updatedMessages };
        }
      }
      
      // If not replacing a temp message, just add the new message
      const updatedMessages = [...state.messages, newMessage];
      debouncedSaveMessagesToLocalStorage(
        updatedMessages,
        action.payload.chatInstanceId || ""
      );
      return { ...state, messages: updatedMessages };

    case ChatActionTypes.RESET_CHAT:
      if (action.payload.chatInstanceId) {
        localStorage.removeItem(
          `chatMessages[${action.payload.chatInstanceId}]`
        );
      }
      return { ...state, messages: [], title: "💬" };

    case ChatActionTypes.UPDATE_NOTIFICATION_COUNT:
      return {
        ...state,
        notificationCount: action.payload.notificationCount || 0,
      };

    case ChatActionTypes.UPDATE_SUGGESTIONS:
      return { ...state, suggestions: action.payload.suggestions || [] };

    case ChatActionTypes.UPDATE_MESSAGE:
      const message = action.payload.message;
      if (!message) return state;

      message.isSent = shouldMessageBeSent(
        message,
        action.payload.userId,
        action.payload.userEmail
      );

      const updatedMessageIndex = state.messages.findIndex(
        (msg) => msg.id === message.id
      );
      if (updatedMessageIndex !== -1) {
        const updatedMessages = [...state.messages];
        updatedMessages[updatedMessageIndex] = {
          ...updatedMessages[updatedMessageIndex],
          ...message,
        };
        debouncedSaveMessagesToLocalStorage(
          updatedMessages,
          action.payload.chatInstanceId || ""
        );
        return { ...state, messages: updatedMessages };
      }

      return {
        ...state,
        messages: [...state.messages, message],
      };

    case ChatActionTypes.UPDATE_TITLE:
      if (!action.payload.chatInstanceId) {
        return { ...state, title: action.payload.title || "💬" };
      }

      if (action.payload.title) {
        const key = `chat-${action.payload.chatInstanceId}-title`;
        localStorage.setItem(key, action.payload.title);
      }

      return { ...state, title: action.payload.title || "💬" };

    case ChatActionTypes.SET_LOADING:
      return {
        ...state,
        isLoading: action.payload.isLoading ?? false,
      };

    default:
      return state;
  }
};

export const initialChatState: ChatState = {
  messages: [],
  notificationCount: 0,
  suggestions: [],
  title: "💬",
  isLoading: false,
};
