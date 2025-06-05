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
    },
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
  console.log(`[AISMARTTALK_CHAT] Hook called with:`, { chatModelId, lang, debug, hasConfig: !!config });
  
  const [error, setError] = useState<Error | null>(null);
  const cycleCountRef = useRef<number>(0);
  const lastSocketStatusRef = useRef<string>("");
  const lastApiCallTimestampRef = useRef<number>(0);
  
  // Prevent re-renders by tracking if we already rendered
  const renderCountRef = useRef<number>(0);
  renderCountRef.current++;

  const logger = useMemo(() => createLogger(debug, "CHAT"), [debug]);

  useEffect(() => {
    cycleCountRef.current++;

    logger.group(`Initialization (render #${cycleCountRef.current})`);
    logger.log("Props:", { chatModelId, lang, config, debug });
    logger.groupEnd();

    return () => {
      logger.log("Hook cleanup");
    };
  }, [logger, chatModelId, lang, config, debug]);

  const { user, setUser, updateUserFromLocalStorage, logout, initialUser } =
    useUser(config?.user);

  console.log(`[AISMARTTALK_CHAT] User state:`, { id: user.id, email: user.email, hasToken: !!user.token });

  useEffect(() => {
    logger.log("User state changed:", {
      id: user.id,
      email: user.email,
      isAnonymous: user.id === "anonymous" || !user.id,
      hasToken: !!user.token,
    });
  }, [user, logger]);

  const { chatModel, setChatModel } = useChatModel({
    chatModelId,
    config,
  });

  console.log(`[AISMARTTALK_CHAT] Chat model:`, chatModel?.id);

  const features = useMemo(
    () => ({
      ...defaultFeatures,
      ...config?.features,
    }),
    [config?.features]
  );

  console.log(`[AISMARTTALK_CHAT] Features:`, features);

  // STABLE MEMOIZED PROPS - This is critical to prevent infinite re-renders
  const chatMessagesProps = useMemo(
    () => {
      console.log(`[AISMARTTALK_CHAT] Creating stable chat messages props`);
      return {
        chatModelId,
        user,
        setUser,
        config,
        lang,
        isAdmin: features.smartadmin,
        debug: debug,
      };
    },
    [chatModelId, user.id, user.email, user.token, lang, features.smartadmin, debug, config?.apiUrl, config?.wsUrl, config?.apiToken]
  );

  console.log(`[AISMARTTALK_CHAT] Chat messages props memoized:`, { 
    chatModelId: chatMessagesProps.chatModelId,
    userId: chatMessagesProps.user.id,
    isAdmin: chatMessagesProps.isAdmin,
    debug: chatMessagesProps.debug,
    renderCount: renderCountRef.current
  });

  const {
    messages,
    chatInstanceId,
    getNewInstance,
    canvases,
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
    createNewChat,
    uploadFile,
    isUploading,
  } = useChatMessages(chatMessagesProps);

  console.log(`[AISMARTTALK_CHAT] Chat messages hook result:`, {
    messagesCount: messages.length,
    chatInstanceId,
    canvasesCount: canvases?.length || 0,
    socketStatus,
    isLoading,
    isUploading,
    renderCount: renderCountRef.current
  });

  useEffect(() => {
    if (socketStatus !== lastSocketStatusRef.current) {
      logger.log(
        `Socket status changed: ${lastSocketStatusRef.current} -> ${socketStatus}`
      );
      lastSocketStatusRef.current = socketStatus;
    }
  }, [socketStatus, logger]);

  useEffect(() => {
    logger.log(`Messages updated: ${messages.length} messages total`);
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      logger.log("Last message:", {
        id: lastMsg.id,
        text:
          lastMsg.text.substring(0, 30) +
          (lastMsg.text.length > 30 ? "..." : ""),
        fromUser: lastMsg.user?.id === user.id,
        isSent: lastMsg.isSent,
        time: new Date(lastMsg.created_at).toISOString(),
      });
    }
  }, [messages, logger, user.id]);

  const fetchMessagesWithLogging = useCallback(() => {
    const now = Date.now();
    const timeSinceLastCall = now - lastApiCallTimestampRef.current;

    logger.group("API Fetch Request");
    logger.log("Time since last API call:", timeSinceLastCall + "ms");
    logger.log("Current messages:", messages.length);
    logger.log("Socket status:", socketStatus);
    logger.log("Chat instance ID:", chatInstanceId);

    lastApiCallTimestampRef.current = now;

    fetchMessagesFromApi();

    logger.groupEnd();
  }, [
    fetchMessagesFromApi,
    messages.length,
    socketStatus,
    chatInstanceId,
    logger,
  ]);

  const handleConversationSelect = useCallback(
    async (id: string) => {
      // Skip if already in this conversation
      if (chatInstanceId === id) return;

      // Direct call to select conversation, this will reset messages internally
      await selectConversation(id);
    },
    [selectConversation, chatInstanceId]
  );

  useEffect(() => {
    if (!chatInstanceId) return;

    // Find the conversation
    const conversation = conversations.find(
      (conv) => conv.id === chatInstanceId
    );

    // Only restore if we found the conversation and don't have messages
    if (conversation && messages.length === 0) {
      selectConversation(chatInstanceId);
    }
  }, [chatInstanceId, conversations, selectConversation, messages.length]);

  /**
   * Logs out the current user and creates a new conversation for anonymous user
   */
  const handleLogout = useCallback(async () => {
    try {
      logger.group("Logout Process");
      logger.log("Starting logout, current user:", {
        id: user.id,
        email: user.email,
      });

      if (chatInstanceId) {
        logger.log("Cleaning up chat instance:", chatInstanceId);
        try {
          localStorage.removeItem(`chat-${chatInstanceId}-history`);
          localStorage.removeItem(`chatMessages[${chatInstanceId}]`);
          localStorage.removeItem(`chat-${chatInstanceId}-suggestions`);
        } catch (error) {
          logger.warn("Error cleaning up chat history during logout:", error);
        }
      }

      logger.log("Executing logout");
      logout();

      logger.log("Creating new conversation for anonymous user");
      const newChatId = await createNewChat();
      logger.log("Created new chat ID:", newChatId);

      if (newChatId) {
        logger.log("Selecting new conversation");
        await selectConversation(newChatId);
      }

      logger.log("Logout process complete");
      logger.groupEnd();
    } catch (error) {
      logger.error("Error during logout:", error);
      setError(
        error instanceof Error
          ? error
          : new Error("Failed to complete logout process")
      );
      logger.groupEnd();
    }
  }, [logout, createNewChat, selectConversation, chatInstanceId, user, logger]);

  const onSendWithLogging = useCallback(
    (messageText: string) => {
      logger.group("Send Message");
      logger.log(
        "Message text:",
        messageText.substring(0, 50) + (messageText.length > 50 ? "..." : "")
      );
      logger.log("Current socket status:", socketStatus);
      logger.log("User:", { id: user.id, hasToken: !!user.token });

      onSend(messageText);

      logger.groupEnd();
    },
    [onSend, socketStatus, user, logger]
  );

  return {
    chatInstanceId,
    createNewChat,
    selectConversation,
    updateChatTitle,
    canvases,

    user,
    setUser,
    updateUserFromLocalStorage,
    logout: handleLogout,

    messages,
    onSend: onSendWithLogging,
    isLoading,
    socketStatus,
    typingUsers,
    conversationStarters,
    suggestions,

    chatModel,
    setChatModel,
    error,

    activeTool,
    conversations,
    setConversations,
    fetchMessagesFromApi: fetchMessagesWithLogging,

    features,

    canvasHistory,

    handleConversationSelect,

    logger,
    debugEnabled: debug,

    uploadFile,
    isUploading,
  };
};

export default useAISmarttalkChat;
