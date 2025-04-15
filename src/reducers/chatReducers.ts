import { FrontChatMessage } from "../types/chat";
import { shouldMessageBeSent, isMessageDuplicate } from "../utils/messageUtils";
import { saveConversationHistory, loadConversationHistory } from "../utils/localStorageHelpers";

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
  try {
    // Récupérer le titre de la conversation existante s'il existe
    const history = loadConversationHistory(chatInstanceId);
    const title = history?.title || "💬";
    
    // Utiliser saveConversationHistory pour s'assurer que les bots ne sont pas propriétaires
    // Note: Nous n'avons pas accès à l'utilisateur courant ici, donc on ne peut pas le passer en paramètre
    // Mais saveConversationHistory vérifiera les propriétaires basés sur les messages existants
    saveConversationHistory(chatInstanceId, title, messages);
  } catch (error) {
    console.error("[AI Smarttalk] Error saving messages to localStorage:", error);
    // Fallback au comportement précédent en cas d'échec
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
      
      // If no messages are provided, maintain current state
      if (!action.payload.messages) {
        return state;
      }
      
      // CRITICAL: If the payload is an empty array and we have messages, 
      // ONLY reset if this is a deliberate reset operation
      if (action.payload.messages.length === 0 && state.messages.length > 0) {
        if (action.payload.resetMessages === true) {
          return { ...state, messages: [] };
        }
        
        // Otherwise keep our existing messages - NEVER clear messages automatically
        console.log("[AISmarttalk] Prevented accidental message reset");
        return state;
      }
      
      // Process isSent status for messages if user information is provided
      if (action.payload.userId) {
        action.payload.messages.forEach(msg => {
          if (!msg.isSent) { // Only set isSent if it's not already set
            msg.isSent = shouldMessageBeSent(msg, action.payload.userId, action.payload.userEmail);
          }
        });
      }
      
      if (state.messages.length > 0 && action.payload.messages?.length) {
        // Create a map of existing messages by ID for faster lookup
        const existingMessages = new Map(state.messages.map(msg => [msg.id, msg]));
        
        // Also create a map of temporary messages by text+user for matching
        const tempMessages = new Map();
        state.messages.forEach(msg => {
          if (msg.id.startsWith('temp-')) {
            const key = `${msg.text}|${msg.user?.id || 'unknown'}`;
            tempMessages.set(key, msg);
          }
        });
        
        const newMessages = action.payload.messages;
        
        // First process all non-temporary messages from new set
        newMessages.forEach(msg => {
          if (msg.id.startsWith('temp-')) return; // Skip temp messages for now
          
          const existing = existingMessages.get(msg.id);
          if (!existing) {
            // New message, add it
            existingMessages.set(msg.id, msg);
          } else if (new Date(msg.updated_at) > new Date(existing.updated_at)) {
            // Updated message, but preserve isSent state from existing
            existingMessages.set(msg.id, {
              ...msg,
              isSent: existing.isSent || msg.isSent
            });
          }
        });
        
        // Then handle temporary messages, matching them with their permanent versions
        newMessages.forEach(msg => {
          if (!msg.id.startsWith('temp-')) return; // Only process temp messages
          
          const key = `${msg.text}|${msg.user?.id || 'unknown'}`;
          
          // Check if we already have a non-temp version of this message
          let hasNonTempVersion = false;
          existingMessages.forEach(existingMsg => {
            if (!existingMsg.id.startsWith('temp-') && 
                existingMsg.text === msg.text && 
                existingMsg.user?.id === msg.user?.id) {
              hasNonTempVersion = true;
            }
          });
          
          // If no non-temp version exists, add the temp message
          if (!hasNonTempVersion) {
            existingMessages.set(msg.id, msg);
          }
        });
        
        const mergedMessages = Array.from(existingMessages.values())
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        const limitedMessages = mergedMessages.slice(-50); // Increased from 30 to 50
        
        // Save to localStorage to ensure persistence
        debouncedSaveMessagesToLocalStorage(
          limitedMessages,
          action.payload.chatInstanceId || ""
        );
        
        return { ...state, messages: limitedMessages };
      }
      
      // Save the messages directly to localStorage if we're replacing all messages
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
        // Instead of simply ignoring duplicates, we should update temp messages with server IDs
        // Find if there's a temp message that matches this one
        const tempMessageIndex = state.messages.findIndex(
          msg => msg.id.startsWith('temp-') && 
                msg.text === newMessage.text &&
                msg.user?.id === newMessage.user?.id
        );
        
        if (tempMessageIndex >= 0 && !newMessage.id.startsWith('temp-')) {
          // Replace temp message with server message
          const updatedMessages = [...state.messages];
          updatedMessages[tempMessageIndex] = {
            ...newMessage,
            isSent: state.messages[tempMessageIndex].isSent || newMessage.isSent // Preserve isSent from temp
          };
          
          debouncedSaveMessagesToLocalStorage(
            updatedMessages,
            action.payload.chatInstanceId || ""
          );
          
          return { ...state, messages: updatedMessages };
        }
        
        // If it's a true duplicate, ignore it
        return state;
      }
      
      newMessage.isSent = shouldMessageBeSent(newMessage, action.payload.userId, action.payload.userEmail);
      
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
      
      message.isSent = shouldMessageBeSent(message, action.payload.userId, action.payload.userEmail);
      
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
