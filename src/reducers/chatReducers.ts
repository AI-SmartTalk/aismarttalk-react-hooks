import { FrontChatMessage } from "../types/chat";
import { shouldMessageBeSent, isMessageDuplicate } from "../utils/messageUtils";
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
    const title = history?.title || "💬";

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

      if (action.payload.messages.length === 0 && state.messages.length > 0) {
        if (action.payload.resetMessages) {
          return { ...state, messages: [] };
        }

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
        const existingMessages = new Map(
          state.messages.map((msg) => [msg.id, msg])
        );

        const tempMessages = new Map();
        state.messages.forEach((msg) => {
          if (msg.id.startsWith("temp-")) {
            const key = `${msg.text}|${msg.user?.id || "unknown"}`;
            tempMessages.set(key, msg);
          }
        });

        const newMessages = action.payload.messages;

        newMessages.forEach((msg) => {
          if (msg.id.startsWith("temp-")) return;
          const existing = existingMessages.get(msg.id);
          if (!existing) {
            existingMessages.set(msg.id, msg);
          } else if (new Date(msg.updated_at) > new Date(existing.updated_at)) {
            existingMessages.set(msg.id, {
              ...msg,
              isSent: existing.isSent || msg.isSent,
            });
          }
        });

        newMessages.forEach((msg) => {
          if (!msg.id.startsWith("temp-")) return;
          const key = `${msg.text}|${msg.user?.id || "unknown"}`;

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

          if (!hasNonTempVersion) {
            existingMessages.set(msg.id, msg);
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

      const messageExists = isMessageDuplicate(newMessage, state.messages);

      if (messageExists) {
        const tempMessageIndex = state.messages.findIndex(
          (msg) =>
            msg.id.startsWith("temp-") &&
            msg.text === newMessage.text &&
            msg.user?.id === newMessage.user?.id
        );

        if (tempMessageIndex >= 0 && !newMessage.id.startsWith("temp-")) {
          const updatedMessages = [...state.messages];
          updatedMessages[tempMessageIndex] = {
            ...newMessage,
            isSent:
              state.messages[tempMessageIndex].isSent || newMessage.isSent,
          };

          debouncedSaveMessagesToLocalStorage(
            updatedMessages,
            action.payload.chatInstanceId || ""
          );

          return { ...state, messages: updatedMessages };
        }

        return state;
      }

      newMessage.isSent = shouldMessageBeSent(
        newMessage,
        action.payload.userId,
        action.payload.userEmail
      );

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
