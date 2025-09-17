import { FrontChatMessage } from "../types/chat";
import { shouldMessageBeSent } from "../utils/messageUtils";
import {
  saveConversationHistory,
  loadConversationHistory,
} from "../utils/localStorageHelpers";
import { CanvasLiveUpdate, CanvasFullContent } from "../hooks/fileUpload/useFileUpload";

export enum ChatActionTypes {
  SET_MESSAGES = "SET_MESSAGES",
  ADD_MESSAGE = "ADD_MESSAGE",
  RESET_CHAT = "RESET_CHAT",
  UPDATE_NOTIFICATION_COUNT = "UPDATE_NOTIFICATION_COUNT",
  UPDATE_SUGGESTIONS = "UPDATE_SUGGESTIONS",
  UPDATE_MESSAGE = "UPDATE_MESSAGE",
  UPDATE_TITLE = "UPDATE_TITLE",
  SET_LOADING = "SET_LOADING",
  SET_CANVASES = "SET_CANVASES",
  CANVAS_LIVE_UPDATE = "CANVAS_LIVE_UPDATE",
}

interface ChatState {
  messages: FrontChatMessage[];
  notificationCount: number;
  suggestions: string[];
  title: string;
  isLoading: boolean;
  canvases: CanvasFullContent[];
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
    canvases?: CanvasFullContent[];
    canvasUpdate?: CanvasLiveUpdate;
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

      newMessage.isSent = shouldMessageBeSent(
        newMessage,
        action.payload.userId,
        action.payload.userEmail
      );
      
      // Handle replacement of locally created messages with server messages
      if (!newMessage.isLocallyCreated) {
        // Look for locally created messages with same content to replace with server version
        const localIndex = state.messages.findIndex(
          msg => 
            msg.isLocallyCreated && 
            msg.text === newMessage.text &&
            // Match user IDs flexibly for anonymous users
            (msg.user?.id === 'anonymous' || 
             msg.user?.id === newMessage.user?.id ||
             (newMessage.user?.id !== 'ai' && msg.user?.id === 'anonymous'))
        );
        
        if (localIndex >= 0) {
          // Replace local message with server message
          const updatedMessages = [...state.messages];
          updatedMessages[localIndex] = {
            ...newMessage,
            isSent: state.messages[localIndex].isSent || newMessage.isSent
          };
          
          debouncedSaveMessagesToLocalStorage(
            updatedMessages,
            action.payload.chatInstanceId || ""
          );
          
          return { ...state, messages: updatedMessages };
        }
        
        // Check for API + WebSocket duplicates: messages from server with same content
        // This handles the case where API responds immediately and WebSocket sends the same message
        const existingServerMessages = state.messages.filter(
          msg =>
            !msg.isLocallyCreated &&
            msg.text === newMessage.text &&
            msg.user?.id === newMessage.user?.id &&
            msg.id !== newMessage.id
        );
        
        if (existingServerMessages.length > 0) {
          // Check if this is likely an API + WebSocket duplicate
          // Allow some time difference for API vs WebSocket timing
          const mostRecentServerMsg = existingServerMessages[existingServerMessages.length - 1];
          const existingTime = new Date(mostRecentServerMsg.created_at).getTime();
          const newTime = new Date(newMessage.created_at).getTime();
          const timeDiff = Math.abs(existingTime - newTime);
          
          // Block if messages are within 10 seconds (API + WebSocket scenario)
          // This is more generous than rapid clicks but catches API/WebSocket duplicates
          if (timeDiff < 10000) {
            return state;
          }
        }
      } else {
        // For locally created messages, only prevent rapid double-clicks (within 500ms)
        const recentLocalDuplicates = state.messages.filter(
          msg =>
            msg.isLocallyCreated &&
            msg.text === newMessage.text &&
            msg.user?.id === newMessage.user?.id &&
            msg.id !== newMessage.id
        );
        
        if (recentLocalDuplicates.length > 0) {
          const mostRecentDuplicate = recentLocalDuplicates[recentLocalDuplicates.length - 1];
          const existingTime = new Date(mostRecentDuplicate.created_at).getTime();
          const newTime = new Date(newMessage.created_at).getTime();
          const timeDiff = Math.abs(existingTime - newTime);
          
          // Only block if within 500ms (rapid double-click protection)
          if (timeDiff < 500) {
            return state;
          }
        }
      }
      
      // Add the message
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

    case ChatActionTypes.SET_CANVASES:
      return {
        ...state,
        canvases: action.payload.canvases || [],
      };

    case ChatActionTypes.CANVAS_LIVE_UPDATE:
      // Canvas live updates are now handled by useCanvasHistory
      // This action is kept for backward compatibility but doesn't modify state
      console.log("Canvas live update received (handled by useCanvasHistory):", action.payload.canvasUpdate);
      return state;

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
  canvases: [],
};
