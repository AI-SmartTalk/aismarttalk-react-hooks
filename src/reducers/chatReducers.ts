import { FrontChatMessage } from "../types/chat";

export enum ChatActionTypes {
  SET_MESSAGES = "SET_MESSAGES",
  ADD_MESSAGE = "ADD_MESSAGE",
  RESET_CHAT = "RESET_CHAT",
  UPDATE_NOTIFICATION_COUNT = "UPDATE_NOTIFICATION_COUNT",
  UPDATE_SUGGESTIONS = "UPDATE_SUGGESTIONS",
  UPDATE_MESSAGE = "UPDATE_MESSAGE",
  UPDATE_TITLE = "UPDATE_TITLE",
}

interface ChatState {
  messages: FrontChatMessage[];
  notificationCount: number;
  suggestions: string[];
  title: string;
}

const saveMessagesToLocalStorage = (
  messages: FrontChatMessage[],
  chatInstanceId: string
) => {
  localStorage.setItem(
    `chatMessages[${chatInstanceId}]`,
    JSON.stringify(messages)
  );
};

export const debouncedSaveMessagesToLocalStorage = debounce(
  saveMessagesToLocalStorage,
  500
);

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number
) {
  let timeoutId: number | null = null;
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
    console.log("No saved messages found for this chat instance.");
    return [];
  }
  try {
    const messages = JSON.parse(savedMessages);
    return messages;
  } catch (e) {
    console.error("Error parsing saved messages from localStorage", e);
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
  };
}

export const chatReducer = (
  state: ChatState,
  action: ChatAction
): ChatState => {
  switch (action.type) {
    case ChatActionTypes.SET_MESSAGES:
      if (!action.payload.chatInstanceId) return state;
      return { ...state, messages: action.payload.messages?.slice(-30) || [] };

    case ChatActionTypes.ADD_MESSAGE:
      const newMessage = action.payload.message;
      if (!newMessage) return state;
      
      const messageExists = state.messages.some(
        (msg) =>
          msg.text === newMessage.text &&
          msg.user?.id === newMessage.user?.id &&
          Math.abs(
            new Date(msg.created_at).getTime() -
              new Date(newMessage.created_at).getTime()
          ) < 1000
      );

      if (!messageExists) {
        const updatedMessages = [...state.messages, newMessage];
        debouncedSaveMessagesToLocalStorage(
          updatedMessages,
          action.payload.chatInstanceId || ""
        );
        return { ...state, messages: updatedMessages };
      }
      return state;

    case ChatActionTypes.RESET_CHAT:
      if (action.payload.chatInstanceId) {
        localStorage.removeItem(
          `chatMessages[${action.payload.chatInstanceId}]`
        );
      }
      return { ...state, messages: [], title: '💬' };

    case ChatActionTypes.UPDATE_NOTIFICATION_COUNT:
      return { ...state, notificationCount: action.payload.notificationCount || 0 };

    case ChatActionTypes.UPDATE_SUGGESTIONS:
      return { ...state, suggestions: action.payload.suggestions || [] };

    case ChatActionTypes.UPDATE_MESSAGE:
      const message = action.payload.message;
      if (!message) return state;

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
      return { ...state, title: action.payload.title || '💬' };

    default:
      return state;
  }
};

export const initialChatState: ChatState = {
  messages: [],
  notificationCount: 0,
  suggestions: [],
  title: '💬',
};

