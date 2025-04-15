import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { ChatConfig, defaultFeatures } from "../types/chatConfig";
import { ChatModel } from "../types/chatModel";
import { useChatMessages } from "./useChatMessage";
import { useChatModel } from "./useChatModel";
import useUser from "./useUser";

/**
 * Configuration props for the AI Smarttalk Chat hook
 * @interface UseAISmarttalkProps
 */
interface UseAISmarttalkProps {
  /** Unique identifier for the chat model */
  chatModelId: string;
  /** Language code for the chat (defaults to 'en') */
  lang?: string;
  /** Optional configuration settings for the chat */
  config?: ChatConfig;
  /** Enable debug logging */
  debug?: boolean;
}

// Debug logger utility
const createLogger = (enabled: boolean, prefix: string) => {
  return {
    log: (...args: any[]) => {
      if (enabled) {
        console.log(`[AISmarttalk][${prefix}]`, ...args);
      }
    },
    error: (...args: any[]) => {
      if (enabled) {
        console.error(`[AISmarttalk][${prefix}]`, ...args);
      }
    },
    warn: (...args: any[]) => {
      if (enabled) {
        console.warn(`[AISmarttalk][${prefix}]`, ...args);
      }
    },
    info: (...args: any[]) => {
      if (enabled) {
        console.info(`[AISmarttalk][${prefix}]`, ...args);
      }
    },
    group: (label: string) => {
      if (enabled) {
        console.group(`[AISmarttalk][${prefix}] ${label}`);
      }
    },
    groupEnd: () => {
      if (enabled) {
        console.groupEnd();
      }
    }
  };
};

/**
 * Custom hook for managing AI Smarttalk chat functionality
 *
 * @param {UseAISmarttalkProps} props - Configuration properties
 * @param {string} props.chatModelId - Unique identifier for the chat model
 * @param {string} [props.lang='en'] - Language code for the chat
 * @param {ChatConfig} [props.config] - Optional configuration settings
 * @param {boolean} [props.debug=false] - Enable debug logging
 *
 * @returns {Object} Chat management functions and state
 * @returns {string} returns.chatInstanceId - Current chat instance identifier
 * @returns {Function} returns.getNewInstance - Creates a new chat instance
 * @returns {Function} returns.setChatInstanceId - Sets the chat instance ID
 * @returns {Function} returns.resetInstance - Resets the current chat instance
 * @returns {Object} returns.user - Current user information
 * @returns {Function} returns.setUser - Updates user information
 * @returns {Function} returns.updateUserFromLocalStorage - Refreshes user data from storage
 * @returns {Array} returns.messages - Array of chat messages
 * @returns {Function} returns.addMessage - Adds a new message to the chat
 * @returns {Array} returns.suggestions - Suggested responses or actions
 * @returns {Function} returns.setMessages - Updates the messages array
 * @returns {Function} returns.resetChat - Clears the chat history
 * @returns {string} returns.socketStatus - Current WebSocket connection status
 * @returns {Array} returns.typingUsers - Users currently typing
 * @returns {Array} returns.conversationStarters - Suggested conversation starters
 * @returns {ChatModel|null} returns.chatModel - Current chat model configuration
 * @returns {Function} returns.setChatModel - Updates the chat model
 * @returns {Error|null} returns.error - Any error that occurred
 * @returns {Object} returns.activeTool - Currently active chat tool
 * @returns {Array} returns.conversations - List of available conversations
 * @returns {Function} returns.setConversations - Updates the conversations list
 * @returns {Function} returns.updateChatTitle - Updates the title of the current chat
 * @returns {Function} returns.resetAll - Resets all chat state
 * @returns {Function} returns.fetchMessagesFromApi - Fetches messages from the API
 * @returns {Function} returns.handleConversationSelect - Handles conversation selection
 */
export const useAISmarttalkChat = ({
  chatModelId,
  lang = "en",
  config,
  debug = false,
}: UseAISmarttalkProps) => {
  const [error, setError] = useState<Error | null>(null);
  const cycleCountRef = useRef<number>(0);
  const lastSocketStatusRef = useRef<string>("");
  const lastApiCallTimestampRef = useRef<number>(0);
  
  // Create logger
  const logger = useMemo(() => createLogger(debug, 'CHAT'), [debug]);
  
  // Log initialization and props
  useEffect(() => {
    cycleCountRef.current++;
    
    logger.group(`Initialization (render #${cycleCountRef.current})`);
    logger.log('Props:', { chatModelId, lang, config, debug });
    logger.groupEnd();
    
    return () => {
      logger.log('Hook cleanup');
    };
  }, [logger, chatModelId, lang, config, debug]);

  // Memoize user-related hooks to prevent unnecessary re-renders
  const { user, setUser, updateUserFromLocalStorage, logout, initialUser } = useUser(config?.user);

  // Log user changes
  useEffect(() => {
    logger.log('User state changed:', { 
      id: user.id, 
      email: user.email, 
      isAnonymous: user.id === 'anonymous' || !user.id,
      hasToken: !!user.token
    });
  }, [user, logger]);

  // Memoize chat model with useMemo to prevent unnecessary updates
  const { chatModel, setChatModel } = useChatModel({ 
    chatModelId, 
    config 
  });

  // Get features configuration with defaults
  const features = useMemo(() => ({
    ...defaultFeatures,
    ...config?.features,
  }), [config?.features]);

  // Memoize chat messages dependencies with stable references
  const chatMessagesProps = useMemo(() => ({
    chatModelId,
    user,
    setUser,
    config,
    lang,
    isAdmin: features.smartadmin,
    debug: debug
  }), [chatModelId, user, config, lang, features.smartadmin, debug]);

  const {
    messages,
    chatInstanceId,
    getNewInstance,
    selectConversation,
    socketStatus,
    typingUsers,
    conversationStarters,
    activeTool,
    fetchMessagesFromApi,
    conversations,
    setConversations,
    canvasHistory,
    onSend,
    isLoading,
    suggestions,
    updateChatTitle,
    createNewChat
  } = useChatMessages(chatMessagesProps);

  // Log socket status changes
  useEffect(() => {
    if (socketStatus !== lastSocketStatusRef.current) {
      logger.log(`Socket status changed: ${lastSocketStatusRef.current} -> ${socketStatus}`);
      lastSocketStatusRef.current = socketStatus;
    }
  }, [socketStatus, logger]);

  // Log message updates
  useEffect(() => {
    logger.log(`Messages updated: ${messages.length} messages total`);
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      logger.log('Last message:', { 
        id: lastMsg.id, 
        text: lastMsg.text.substring(0, 30) + (lastMsg.text.length > 30 ? '...' : ''),
        fromUser: lastMsg.user?.id === user.id,
        isSent: lastMsg.isSent,
        time: new Date(lastMsg.created_at).toISOString()
      });
    }
  }, [messages, logger, user.id]);

  // Wrap fetchMessagesFromApi with logging
  const fetchMessagesWithLogging = useCallback(() => {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTimestampRef.current;
    
    logger.group('API Fetch Request');
    logger.log('Time since last API call:', timeSinceLastCall + 'ms');
    logger.log('Current messages:', messages.length);
    logger.log('Socket status:', socketStatus);
    logger.log('Chat instance ID:', chatInstanceId);
    
    // Update timestamp before call
    lastApiCallTimestampRef.current = now;
    
    // Call the original function
    fetchMessagesFromApi();
    
    logger.groupEnd();
  }, [fetchMessagesFromApi, messages.length, socketStatus, chatInstanceId, logger]);

  // Add new function to handle both chat instance and message selection
  const handleConversationSelect = useCallback(async (id: string) => {
    try {
      logger.group('Conversation Select');
      logger.log('Selecting conversation:', id);
      
      // First select the conversation which will handle both instance and message selection
      await selectConversation(id);
      
      logger.log('Conversation selection complete');
      logger.groupEnd();
    } catch (error) {
      logger.error('Error selecting conversation:', error);
      setError(error instanceof Error ? error : new Error('Failed to select conversation'));
      logger.groupEnd();
    }
  }, [selectConversation, logger]);

  // Add effect to handle initial conversation restoration
  useEffect(() => {
    if (!chatInstanceId) return;
    
    const conversation = conversations.find(conv => conv.id === chatInstanceId);
    if (conversation) {
      logger.log('Restoring conversation:', chatInstanceId);
      selectConversation(chatInstanceId);
    }
  }, [chatInstanceId, conversations, selectConversation, logger]);

  /**
   * Logs out the current user and creates a new conversation for anonymous user
   */
  const handleLogout = useCallback(async () => {
    try {
      logger.group('Logout Process');
      logger.log('Starting logout, current user:', { id: user.id, email: user.email });
      
      // If we have a current chat instance, clean up its storage
      if (chatInstanceId) {
        logger.log('Cleaning up chat instance:', chatInstanceId);
        // Clean up chat history for the current conversation
        try {
          localStorage.removeItem(`chat-${chatInstanceId}-history`);
          localStorage.removeItem(`chatMessages[${chatInstanceId}]`);
          localStorage.removeItem(`chat-${chatInstanceId}-suggestions`);
        } catch (error) {
          logger.warn('Error cleaning up chat history during logout:', error);
        }
      }
      
      // First, log out the user (resets to anonymous)
      logger.log('Executing logout');
      logout();
      
      // Then create a new conversation for the anonymous user
      logger.log('Creating new conversation for anonymous user');
      const newChatId = await createNewChat();
      logger.log('Created new chat ID:', newChatId);
      
      // Select the new conversation
      if (newChatId) {
        logger.log('Selecting new conversation');
        await selectConversation(newChatId);
      }
      
      logger.log('Logout process complete');
      logger.groupEnd();
    } catch (error) {
      logger.error('Error during logout:', error);
      setError(error instanceof Error ? error : new Error('Failed to complete logout process'));
      logger.groupEnd();
    }
  }, [logout, createNewChat, selectConversation, chatInstanceId, user, logger]);

  // Wrap onSend with logging
  const onSendWithLogging = useCallback((messageText: string) => {
    logger.group('Send Message');
    logger.log('Message text:', messageText.substring(0, 50) + (messageText.length > 50 ? '...' : ''));
    logger.log('Current socket status:', socketStatus);
    logger.log('User:', { id: user.id, hasToken: !!user.token });
    
    onSend(messageText);
    
    logger.groupEnd();
  }, [onSend, socketStatus, user, logger]);

  return {
    // Chat instance related
    chatInstanceId,
    createNewChat,
    selectConversation,
    updateChatTitle,    

    // User related
    user,
    setUser,
    updateUserFromLocalStorage,
    logout: handleLogout,

    // Messages related
    messages,
    onSend: onSendWithLogging,
    isLoading,
    socketStatus,
    typingUsers,
    conversationStarters,
    suggestions,

    // Chat model related
    chatModel,
    setChatModel,
    error,

    // Tools and features
    activeTool,
    conversations,
    setConversations,
    fetchMessagesFromApi: fetchMessagesWithLogging,

    // Features
    features,

    // Canva functions
    canvasHistory,

    // New function
    handleConversationSelect,
    
    // Debug functions
    logger,
    debugEnabled: debug
  };
};

export default useAISmarttalkChat;
