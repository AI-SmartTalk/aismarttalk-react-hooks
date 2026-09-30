import { FrontChatMessage } from "../types/chat";
import { mergeMessages } from "../utils/mergeMessages";
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

      // Check if we're switching to a different chat instance
      const currentChatInstanceId = state.messages[0]?.chatInstanceId;
      const newChatInstanceId = action.payload.chatInstanceId;
      const isSwitchingConversation = 
        currentChatInstanceId && 
        currentChatInstanceId !== newChatInstanceId;

      if (isSwitchingConversation) {
        // When switching conversations, always replace messages completely
        if (action.payload.messages.length > 0) {
          debouncedSaveMessagesToLocalStorage(
            action.payload.messages,
            newChatInstanceId || ""
          );
          return { ...state, messages: action.payload.messages.slice(-50) };
        }

        // If no messages for new conversation, clear state
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

      const syncedMessages = mergeMessages(state.messages, action.payload.messages).slice(-50);
      debouncedSaveMessagesToLocalStorage(syncedMessages, action.payload.chatInstanceId);
      return { ...state, messages: syncedMessages };

    case ChatActionTypes.ADD_MESSAGE: {
      const incoming = action.payload.message;
      if (!incoming) return state;
      const newMessage = { ...incoming, isSent: incoming.metadata?.sentAsAgent === true ? false :
        incoming.isSent ?? shouldMessageBeSent(incoming, action.payload.userId, action.payload.userEmail) };
      const messages = mergeMessages(state.messages, [newMessage]).slice(-50);
      debouncedSaveMessagesToLocalStorage(messages, action.payload.chatInstanceId || "");
      return { ...state, messages };
    }

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
