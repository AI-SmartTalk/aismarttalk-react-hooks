import { FrontChatMessage } from "../types/chat";

export enum ChatActionTypes {
  SET_MESSAGES = "SET_MESSAGES",
  ADD_MESSAGE = "ADD_MESSAGE",
  RESET_CHAT = "RESET_CHAT",
  UPDATE_NOTIFICATION_COUNT = "UPDATE_NOTIFICATION_COUNT",
  UPDATE_SUGGESTIONS = "UPDATE_SUGGESTIONS",
  UPDATE_MESSAGE = "UPDATE_MESSAGE",
  UPDATE_TITLE = "UPDATE_TITLE",
  SET_LOADING = "SET_LOADING"
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
  };
}

export const chatReducer = (
  state: ChatState,
  action: ChatAction
): ChatState => {
  switch (action.type) {
    case ChatActionTypes.SET_MESSAGES:
      if (!action.payload.chatInstanceId) return state;
      
      
      if (action.payload.userId === 'anonymous' && action.payload.messages) {      
        action.payload.messages.forEach(msg => {
          if (msg.user?.id === 'anonymous' || msg.user?.email === 'anonymous@example.com') {
            msg.isSent = true;
          }
        });
      }
      
      
      if (state.messages.length > 0 && action.payload.messages?.length) {
        const existingMessages = new Map(state.messages.map(msg => [msg.id, msg]));
        const newMessages = action.payload.messages;
        
        
        newMessages.forEach(msg => {
          const existing = existingMessages.get(msg.id);
          if (!existing || new Date(msg.updated_at) > new Date(existing.updated_at)) {
            existingMessages.set(msg.id, msg);
          }
        });
        
        
        const mergedMessages = Array.from(existingMessages.values())
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        return { ...state, messages: mergedMessages.slice(-30) };
      }
      
      return { ...state, messages: action.payload.messages?.slice(-30) || [] };

    case ChatActionTypes.ADD_MESSAGE:
      const newMessage = action.payload.message;
      if (!newMessage) return state;
                                    
      const messageExists = state.messages.some(
        (msg) => 
          msg.id === newMessage.id || 
          (
            msg.text === newMessage.text &&
            
            Math.abs(
              new Date(msg.created_at).getTime() -
              new Date(newMessage.created_at).getTime()
            ) < 5000 
          ) ||
          
          (
            action.payload.userId === 'anonymous' &&
            msg.text.trim() === newMessage.text.trim() 
          )
      );

      if (!messageExists) {       
        const updatedMessages = [...state.messages, newMessage];
        debouncedSaveMessagesToLocalStorage(
          updatedMessages,
          action.payload.chatInstanceId || ""
        );
        return { ...state, messages: updatedMessages };
      } else {       
        
        if (
          (newMessage.user?.id === 'anonymous' || newMessage.user?.email === 'anonymous@example.com') && 
          action.payload.userId === 'anonymous'
        ) {          
          
          const messagesToUpdate: number[] = [];
          state.messages.forEach((msg, index) => {
            if (msg.text === newMessage.text && 
                Math.abs(
                  new Date(msg.created_at).getTime() -
                  new Date(newMessage.created_at).getTime()
                ) < 10000 && 
                !msg.isSent) {
              messagesToUpdate.push(index);
            }
          });
          
          if (messagesToUpdate.length > 0) {            
            const updatedMessages = [...state.messages];
            
            messagesToUpdate.forEach(index => {              
              updatedMessages[index] = {
                ...updatedMessages[index],
                isSent: true,
              };
            });
            
            debouncedSaveMessagesToLocalStorage(
              updatedMessages,
              action.payload.chatInstanceId || ""
            );
            
            return { ...state, messages: updatedMessages };
          }
        }
        
        return state;
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
