import { useState, useEffect, useMemo, useCallback } from "react";
import { useChatInstance } from "./useChatInstance";
import { useChatMessages } from "./useChatMessage";
import useUser from "./useUser";
import { ChatConfig } from "../types/chatConfig";
import { ChatModel } from "../types/chatModel";
import { useChatModel } from "./useChatModel";

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
 */
export const useAISmarttalkChat = ({
  chatModelId,
  lang = "en",
  config,
}: UseAISmarttalkProps) => {
  const [error, setError] = useState<Error | null>(null);

  // Memoize user-related hooks to prevent unnecessary re-renders
  const { user, setUser, updateUserFromLocalStorage } = useUser();

  // Memoize chat model with useMemo to prevent unnecessary updates
  const { chatModel, setChatModel } = useChatModel({ 
    chatModelId, 
    config 
  });

  // Memoize chat instance dependencies
  const chatInstanceProps = useMemo(() => ({
    chatModelId,
    lang,
    config,
    user: user ?? undefined,
  }), [chatModelId, lang, config, user]);

  const { 
    chatInstanceId, 
    getNewInstance, 
    resetInstance, 
    setChatInstanceId 
  } = useChatInstance(chatInstanceProps);

  // Memoize chat messages dependencies with stable references
  const chatMessagesProps = useMemo(() => ({
    chatModelId,
    chatInstanceId: chatInstanceId as string,
    user,
    setUser,
    config,
  }), [chatModelId, chatInstanceId, user, config]);

  const {
    messages,
    addMessage,
    suggestions,
    setMessages,
    resetChat,
    socketStatus,
    typingUsers,
    conversationStarters,
    activeTool,
    fetchMessagesFromApi,
    conversations,
    setConversations,
    updateChatTitle,
    canvasHistory,
    onSend,
    isLoading

  } = useChatMessages(chatMessagesProps);

  // Memoize resetAll callback
  const resetAll = useCallback(() => {
    resetInstance();
    resetChat();
    setChatModel(null);
  }, [resetInstance, resetChat, setChatModel]);

  return {
    // Chat instance related
    chatInstanceId,
    getNewInstance,
    setChatInstanceId,
    resetInstance,

    // User related
    user,
    setUser,
    updateUserFromLocalStorage,

    // Messages related
    messages,
    onSend,
    isLoading,
    suggestions,
    setMessages,
    resetChat,
    socketStatus,
    typingUsers,
    conversationStarters,

    // Chat model related
    chatModel,
    setChatModel,
    error,

    // Tools and features
    activeTool,
    conversations,
    setConversations,
    updateChatTitle,

    // Utility functions
    resetAll,
    fetchMessagesFromApi,

    // Canva functions
    canvasHistory
  };
};

export default useAISmarttalkChat;
