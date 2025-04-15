import { useCallback, useMemo, useState, useEffect } from "react";
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
}

/**
 * Custom hook for managing AI Smarttalk chat functionality
 *
 * @param {UseAISmarttalkProps} props - Configuration properties
 * @param {string} props.chatModelId - Unique identifier for the chat model
 * @param {string} [props.lang='en'] - Language code for the chat
 * @param {ChatConfig} [props.config] - Optional configuration settings
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
}: UseAISmarttalkProps) => {
  const [error, setError] = useState<Error | null>(null);

  // Memoize user-related hooks to prevent unnecessary re-renders
  const { user, setUser, updateUserFromLocalStorage, logout, initialUser } = useUser(config?.user);

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
    isAdmin: features.smartadmin
  }), [chatModelId, user, config, lang, features.smartadmin]);

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

  // Add new function to handle both chat instance and message selection
  const handleConversationSelect = useCallback(async (id: string) => {
    try {
      // First select the conversation which will handle both instance and message selection
      await selectConversation(id);
    } catch (error) {
      console.error('Error selecting conversation:', error);
      setError(error instanceof Error ? error : new Error('Failed to select conversation'));
    }
  }, [selectConversation]);

  // Add effect to handle initial conversation restoration
  useEffect(() => {
    if (!chatInstanceId) return;
    
    const conversation = conversations.find(conv => conv.id === chatInstanceId);
    if (conversation) {
      selectConversation(chatInstanceId);
    }
  }, [chatInstanceId, conversations, selectConversation]);

  /**
   * Logs out the current user and creates a new conversation for anonymous user
   */
  const handleLogout = useCallback(async () => {
    try {
      // If we have a current chat instance, clean up its storage
      if (chatInstanceId) {
        // Clean up chat history for the current conversation
        try {
          localStorage.removeItem(`chat-${chatInstanceId}-history`);
          localStorage.removeItem(`chatMessages[${chatInstanceId}]`);
          localStorage.removeItem(`chat-${chatInstanceId}-suggestions`);
        } catch (error) {
          console.warn('[AI Smarttalk] Error cleaning up chat history during logout:', error);
        }
      }
      
      // First, log out the user (resets to anonymous)
      logout();
      
      // Then create a new conversation for the anonymous user
      const newChatId = await createNewChat();
      
      // Select the new conversation
      if (newChatId) {
        await selectConversation(newChatId);
      }
    } catch (error) {
      console.error('Error during logout:', error);
      setError(error instanceof Error ? error : new Error('Failed to complete logout process'));
    }
  }, [logout, createNewChat, selectConversation, chatInstanceId]);

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
    onSend,
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
    fetchMessagesFromApi,

    // Features
    features,

    // Canva functions
    canvasHistory,

    // New function
    handleConversationSelect
  };
};

export default useAISmarttalkChat;
