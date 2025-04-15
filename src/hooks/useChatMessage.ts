import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ChatActionTypes,
  chatReducer,
  debounce,
  initialChatState,
} from "../reducers/chatReducers";
import { ChatHistoryItem, CTADTO, FrontChatMessage } from "../types/chat";
import {
  ChatError,
  ChatErrorType,
  UseChatMessagesOptions,
} from "../types/chatConfig";
import { defaultApiUrl, defaultWsUrl } from "../types/config";
import { Tool } from "../types/tools";
import { TypingUser } from "../types/typingUsers";
import { User } from "../types/users";
import {
  loadConversationHistory,
  saveConversationHistory,
} from "../utils/localStorageHelpers";
import useCanvasHistory from "./canva/useCanvasHistory";
import { useMessageHandler } from "./chat/useMessageHandler";
import { useSocketHandler } from "./chat/useSocketHandler";
import useChatInstance from "./useChatInstance";
import { shouldMessageBeSent } from "../utils/messageUtils";

/**
 * Custom hook for managing chat messages and related functionality
 * @param {Object} options - The configuration options for the chat
 * @param {string} options.chatModelId - Identifier for the chat model being used
 * @param {User} options.user - Current user information
 * @param {Function} options.setUser - Function to update user information
 * @param {Object} options.config - Additional configuration options
 * @param {string} [options.config.apiUrl] - API endpoint URL
 * @param {string} [options.config.wsUrl] - WebSocket server URL
 * @param {string} [options.config.apiToken] - Authentication token for API requests
 * @param {string} [options.lang] - Language for the chat
 * @param {boolean} [options.isAdmin] - Indicates if the user is an admin
 * @param {boolean} [options.debug] - Indicates if debug mode is enabled
 * @returns {Object} Chat state and methods
 * @returns {FrontChatMessage[]} returns.messages - Array of chat messages
 * @returns {number} returns.notificationCount - Number of unread notifications
 * @returns {string[]} returns.suggestions - Message suggestions
 * @returns {ChatError} returns.error - Error information
 * @returns {Function} returns.setMessages - Function to set messages
 * @returns {Function} returns.setNotificationCount - Function to update notification count
 * @returns {Function} returns.updateSuggestions - Function to update suggestions
 * @returns {Function} returns.addMessage - Function to add a new message
 * @returns {Function} returns.resetChat - Function to reset the chat
 * @returns {string} returns.socketStatus - Current WebSocket connection status
 * @returns {TypingUser[]} returns.typingUsers - Array of currently typing users
 * @returns {CTADTO[]} returns.conversationStarters - Available conversation starters
 * @returns {Tool|null} returns.activeTool - Currently active tool
 * @returns {Function} returns.fetchMessagesFromApi - Function to fetch messages from API
 * @returns {string} returns.chatTitle - Current chat title
 * @returns {Function} returns.updateChatTitle - Function to update chat title
 * @returns {ChatHistoryItem[]} returns.conversations - Array of chat conversations
 * @returns {Function} returns.setConversations - Function to update conversations
 * @returns {Function} returns.saveConversationHistory - Function to save chat history
 * @returns {Canvas} returns.canvas - Canvas object
 * @returns {CanvasHistory} returns.canvasHistory - Canvas history object
 * @returns {Function} returns.selectConversation - Function to select a conversation
 * @returns {string} returns.chatInstanceId - Current chat instance ID
 * @returns {Function} returns.getNewInstance - Function to get a new chat instance
 * @returns {Function} returns.createNewChat - Function to create a new chat
 */
export const useChatMessages = ({
  chatModelId,
  user,
  setUser,
  config,
  lang = "en",
  isAdmin = false,
  debug = false,
}: UseChatMessagesOptions) => {
  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalApiToken = config?.apiToken || "";
  const finalWsUrl = config?.wsUrl || defaultWsUrl;
  const storageKey = `chatInstanceId[${chatModelId}${isAdmin ? "-smartadmin" : "-standard"}]`;

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const { chatInstanceId, setChatInstanceId, getNewInstance } = useChatInstance(
    { chatModelId, lang, config, isAdmin: isAdmin, user }
  );
  const [socketStatus, setSocketStatus] = useState<string>("disconnected");
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [conversationStarters, setConversationStarters] = useState<CTADTO[]>(
    []
  );
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [chatTitle, setChatTitle] = useState<string>("");
  const [conversations, setConversations] = useState<ChatHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<ChatErrorType | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);
  const activeToolTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedRef = useRef<boolean>(false);
  const previousChatInstanceRef = useRef<string | null>(null);
  const cachedMessagesRef = useRef<Record<string, FrontChatMessage[]>>({});

  // Add a reference to the current number of messages
  const messagesCountRef = useRef<number>(0);

  // Store message count in ref whenever it changes
  useEffect(() => {
    messagesCountRef.current = state.messages.length;
  }, [state.messages.length]);

  // When chatInstanceId changes, try to restore messages from our cache
  useEffect(() => {
    if (chatInstanceId && chatInstanceId !== previousChatInstanceRef.current) {
      previousChatInstanceRef.current = chatInstanceId;
      
      // If we have cached messages for this instance, use them immediately
      if (cachedMessagesRef.current[chatInstanceId]?.length > 0) {
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { 
            chatInstanceId: chatInstanceId, 
            messages: cachedMessagesRef.current[chatInstanceId],
            userId: user?.id,
            userEmail: user?.email
          },
        });
      }
    }
  }, [chatInstanceId, user?.id, user?.email]);

  // Cache messages whenever they change
  useEffect(() => {
    if (chatInstanceId && state.messages.length > 0) {
      cachedMessagesRef.current[chatInstanceId] = state.messages;
    }
  }, [chatInstanceId, state.messages]);

  /**
   * Handle API errors centrally and provide detailed error information
   *
   * @param statusCode HTTP status code from response
   * @param defaultMessage Default error message
   * @returns Object with message, errorType and statusCode for consistent error handling
   */
  const handleApiError = useCallback(
    (statusCode: number, defaultMessage: string) => {
      let message = defaultMessage;
      let errorType: ChatErrorType = "unknown";

      switch (statusCode) {
        case 401:
          message = "Unauthorized: You need to login to access this chat.";
          errorType = "auth";
          break;
        case 403:
          message = "Forbidden: You don't have permission to access this chat.";
          errorType = "permission";
          break;
        case 429:
          message = "Too many requests. Please wait before trying again.";
          errorType = "rate_limit";
          break;
        case 400:
          message =
            "Bad request. There might be an issue with your chat configuration.";
          errorType = "validation";
          break;
        case 404:
          message = "Chat not found. The conversation may have been deleted.";
          errorType = "not_found";
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          message =
            "Server error. Please contact your administrator for assistance.";
          errorType = "server";
          break;
        default:
          if (statusCode >= 500) {
            errorType = "server";
          } else if (statusCode >= 400) {
            errorType = "client";
          } else {
            errorType = "unknown";
          }
      }

      setError(message);
      setErrorType(errorType);
      setErrorCode(statusCode);

      return { message, errorType, statusCode };
    },
    []
  );

  // Clear all error states
  const clearError = useCallback(() => {
    setError(null);
    setErrorType(null);
    setErrorCode(null);
  }, []);

  const setApiError = useCallback(
    (
      message: string,
      type: ChatErrorType = "unknown",
      code: number | null = null
    ) => {
      setError(message);
      setErrorType(type);
      setErrorCode(code);
    },
    []
  );

  const selectConversation = useCallback(
    async (id: string | undefined) => {
      try {
        if (!id) {
          await getNewInstance();
          return;
        }

        // Set local instance ID first for immediate UI updates
        setChatInstanceId(id);
        localStorage.setItem(storageKey, id);

        // Critical: Check for cached messages first to avoid any flicker
        // If we have cached messages, use them immediately while API loads
        if (cachedMessagesRef.current[id]?.length > 0) {
          dispatch({
            type: ChatActionTypes.SET_MESSAGES,
            payload: { 
              chatInstanceId: id, 
              messages: cachedMessagesRef.current[id],
              userId: user?.id,
              userEmail: user?.email
            },
          });
        }
        
        // Avoid dispatch of empty messages array which could cause flickering
        // Logic in reducer will prevent clearing messages anyway, but better not to trigger it

        // Fetch messages from API
        const response = await fetch(`${finalApiUrl}/api/chat/history/${id}`, {
          headers: finalApiToken
            ? { Authorization: `Bearer ${finalApiToken}` }
            : {},
        });

        if (!response.ok) {
          handleApiError(
            response.status,
            `Failed to fetch messages: ${response.status}`
          );
          return;
        }

        // Clear any errors upon successful conversation selection
        clearError();

        const data = await response.json();

        const apiMessages = data.messages || [];
        if (apiMessages?.length > 0) {
          const currentUserId = data.connectedOrAnonymousUser?.id || user?.id;

          const processedMessages = apiMessages.map((message: any) => {
            return {
              id: message.id,
              text: message.text,
              chatInstanceId: id,
              created_at: message.created_at,
              updated_at: message.updated_at,
              user: message.user,
              isSent: shouldMessageBeSent(
                message,
                currentUserId,
                data.connectedOrAnonymousUser?.email || user?.email
              ),
            };
          });

          // Cache messages
          cachedMessagesRef.current[id] = processedMessages;

          dispatch({
            type: ChatActionTypes.SET_MESSAGES,
            payload: { 
              chatInstanceId: id, 
              messages: processedMessages,
              userId: currentUserId,
              userEmail: data.connectedOrAnonymousUser?.email || user?.email
            },
          });
        }
      } catch (error) {
        console.error("Error selecting conversation:", error);

        // Handle network errors or other non-HTTP errors
        setError(
          error instanceof Error
            ? error.message
            : "Unknown error selecting conversation"
        );
        setErrorType("network");
        setErrorCode(null);
      }
    },
    [
      finalApiUrl,
      finalApiToken,
      getNewInstance,
      handleApiError,
      setChatInstanceId,
      storageKey,
      clearError,
      user?.id,
      user?.email,
    ]
  );

  // Initialize chat instance
  useEffect(() => {
    // Don't do anything if we already have a chat instance
    if (chatInstanceId) return;
    // Don't do anything in admin mode
    if (isAdmin) return;

    // Attempt to load from stored instance
    const savedInstance = localStorage.getItem(storageKey);
    if (savedInstance) {
      // Set directly rather than calling selectConversation to avoid multiple API calls
      setChatInstanceId(savedInstance);
    } else {
      // Create new chat instance if none exists
      getNewInstance();
    }
  }, []); // Empty dependency array to run only once

  // Load initial conversation history
  useEffect(() => {
    if (!chatInstanceId) return;
    console.log(
      "[AISmarttalk] chatInstanceId changed, checking history:",
      chatInstanceId
    );

    // Reset initialization state when chatInstanceId changes
    hasInitializedRef.current = false;

    const history = loadConversationHistory(chatInstanceId);
    if (
      history &&
      Array.isArray(history.messages) &&
      history.messages.length > 0
    ) {
      console.log(
        "[AISmarttalk] Loading from local history:",
        history.messages.length,
        "messages"
      );
      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: {
          chatInstanceId,
          messages: history.messages,
          title: history.title || "",
        },
      });
      setChatTitle(history.title || "");

      // Mark as initialized since we loaded from history
      hasInitializedRef.current = true;

      // Update conversations to ensure the history is reflected
      setConversations((prev) => {
        const existing = prev.findIndex((c) => c.id === chatInstanceId);
        if (existing === -1) {
          const newConversation = {
            id: chatInstanceId,
            title: history.title || "",
            messages: history.messages,
            lastUpdated: new Date().toISOString(),
          };
          return [newConversation, ...prev];
        }
        return prev;
      });
    } else {
      // Fetch if we haven't initialized this chat instance yet
      console.log(
        "[AISmarttalk] No history found, fetch from API"
      );
      fetchMessagesFromApi();
    }
  }, [chatInstanceId]); // Only chatInstanceId as dependency

  // Load conversation list from storage
  useEffect(() => {
    const stored = localStorage.getItem(`chat-conversations-${chatModelId}`);
    if (stored) {
      try {
        const parsedConversations = JSON.parse(stored);
        setConversations((prev) => {
          if (JSON.stringify(prev) !== stored) {
            return parsedConversations;
          }
          return prev;
        });
      } catch (e) {
        console.error("Error loading conversations:", e);
      }
    }
  }, [chatModelId]);

  const debouncedTypingUsersUpdate = debounce((data: TypingUser) => {
    setTypingUsers((prev) => {
      const exists = prev.some((u) => u.userId === data.userId);
      if (data.isTyping) {
        return exists
          ? prev.map((u) =>
              u.userId === data.userId ? { ...u, isTyping: true } : u
            )
          : [...prev, data];
      }
      return prev.filter((u) => u.userId !== data.userId);
    });
  }, 500);

  const fetchMessagesFromApi = useCallback(async () => {
    console.log("[AISmarttalk] fetchMessagesFromApi called with:", {
      messages: state.messages.length,
      lastMessageTime: socketRef.current?._lastMessageTime
        ? new Date(socketRef.current?._lastMessageTime).toISOString()
        : "none",
      hasInitialized: hasInitializedRef.current,
    });

    const currentInstanceId = chatInstanceId;
    if (!currentInstanceId) {
      return;
    }

    // ABSOLUTELY BLOCK API fetch if we have already initialized
    if (hasInitializedRef.current) {
      console.log("[AISmarttalk] Skipping API fetch - already initialized");
      return;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (finalApiToken) {
        headers.appToken = finalApiToken;
      }

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers.Authorization = `Bearer ${user.token}`;
      }

      const response = await fetch(
        `${finalApiUrl}/api/chat/history/${currentInstanceId}`,
        {
          headers,
        }
      );

      if (!response.ok) {
        handleApiError(
          response.status,
          `Failed to fetch messages: ${response.status}`
        );
        return;
      }

      // Clear errors upon successful fetch
      clearError();

      const data = await response.json();
      const apiMessages = data.messages || [];

      if (apiMessages.length > 0) {
        const currentUserId = data.connectedOrAnonymousUser?.id || user?.id;

        const processedMessages = apiMessages.map((message: any) => {
          return {
            id: message.id,
            text: message.text,
            chatInstanceId: currentInstanceId,
            created_at: message.created_at,
            updated_at: message.updated_at,
            user: message.user,
            isSent: shouldMessageBeSent(
              message,
              currentUserId,
              data.connectedOrAnonymousUser?.email || user?.email
            ),
          };
        });

        // Cache messages for future use
        cachedMessagesRef.current[currentInstanceId] = processedMessages;

        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: {
            chatInstanceId: currentInstanceId,
            messages: processedMessages,
            userId: currentUserId,
            userEmail: data.connectedOrAnonymousUser?.email || user?.email
          },
        });

        // Update title if available
        if (data.title) {
          setChatTitle(data.title);
        }
      } else if (state.messages.length > 0) {
        // If API returns no messages but we have local messages,
        // don't reset them - they might be pending sync to the server
        console.log('[AISmarttalk] API returned no messages but keeping local messages:', state.messages.length);
      }

      // Mark as initialized after successful fetch
      hasInitializedRef.current = true;
    } catch (error) {
      console.error("Error fetching messages:", error);
      setApiError(
        error instanceof Error
          ? error.message
          : "Unknown error fetching messages",
        "network"
      );
    }
  }, [chatInstanceId, finalApiUrl, user, state.messages.length]);

  const { addMessage } = useMessageHandler(
    chatInstanceId,
    user,
    dispatch,
    chatTitle,
    setChatTitle,
    state.messages
  );

  const canvasHistory = useCanvasHistory(chatModelId);

  const socketRef = useSocketHandler(
    chatInstanceId,
    user,
    finalWsUrl,
    finalApiUrl,
    chatModelId,
    dispatch,
    setSocketStatus,
    setTypingUsers,
    setConversationStarters,
    setActiveTool,
    setUser,
    debouncedTypingUsersUpdate,
    canvasHistory,
    state.messages,
    debug
  );

  // Handle socket reconnection
  useEffect(() => {
    if (!chatInstanceId || !socketRef?.current) return;

    const shouldReconnect =
      socketStatus === "disconnected" && !isAdmin && state.messages.length > 0;

    if (shouldReconnect) {
      console.log(
        "[AISmarttalk] Attempting socket reconnection with existing messages"
      );
      try {
        if (
          socketRef.current.disconnect &&
          typeof socketRef.current.disconnect === "function"
        ) {
          socketRef.current.disconnect();
        }

        if (
          socketRef.current.connect &&
          typeof socketRef.current.connect === "function"
        ) {
          socketRef.current.connect();
        }
      } catch (err) {
        console.error("Error reconnecting socket:", err);
      }
    }
  }, [chatInstanceId, socketStatus, isAdmin, state.messages.length > 0]);

  const dismissActiveTool = useCallback((delay = 5000) => {
    if (activeToolTimeoutRef.current) {
      clearTimeout(activeToolTimeoutRef.current);
    }

    activeToolTimeoutRef.current = setTimeout(() => {
      setActiveTool(null);
      activeToolTimeoutRef.current = null;
    }, delay);
  }, []);

  const showTemporaryToolState = useCallback(
    (state: string, icon?: string) => {
      setActiveTool({
        id: `temp-${state}-${Date.now()}`,
        name: state,
        icon: icon || "status",
        type: "status",
      } as Tool);
      dismissActiveTool();
    },
    [dismissActiveTool]
  );

  const onSend = async (messageText: string) => {
    if (state.isLoading || !chatInstanceId) return;
    dispatch({
      type: ChatActionTypes.SET_LOADING,
      payload: { isLoading: true },
    });

    showTemporaryToolState("Sending...", "loading");

    // Generate a stable ID for this message for better tracking/deduplication
    const messageId = `temp-${user.id || "anonymous"}-${Date.now()}`;

    const userMessage: FrontChatMessage = {
      id: messageId,
      text: messageText,
      isSent: true, // Always mark messages created by the user through UI as sent
      chatInstanceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user: {
        id: user.id ?? "",
        email: user.email ?? "",
        name: user.name ?? "",
        image: user.image ?? "",
      },
    };

    // CRITICAL: Update lastMessageReceivedRef to prevent API fetch after message is sent
    // This marks that we just received a message (our own) and don't need to fetch again
    if (socketRef.current) {
      const now = Date.now();
      socketRef.current._lastMessageTime = now;
      if (socketRef.current.lastMessageReceivedRef) {
        socketRef.current.lastMessageReceivedRef.current = now;
      }
    }

    addMessage(userMessage);

    try {
      showTemporaryToolState("🧠", "thinking");

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        appToken: finalApiToken,
      };

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers["Authorization"] = `Bearer ${user.token}`;
      }

      const endpoint = isAdmin
        ? `${finalApiUrl}/api/admin/chatModel/${chatModelId}/smartadmin/chat`
        : `${finalApiUrl}/api/chat`;

      const requestData = isAdmin
        ? {
            query: messageText,
            message: messageText,
            lang,
            chatInstanceId,
            chatModelId,
            timezone: new Date().toString(),
            userAgent: navigator.userAgent,
          }
        : {
            message: messageText,
            messages: [...state.messages, userMessage],
            chatInstanceId,
            chatModelId,
            lang,
          };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        // Use the centralized error handler for API errors
        const { message, errorType, statusCode } = handleApiError(
          response.status,
          `Error sending message: ${response.status}`
        );

        showTemporaryToolState("Error", "error");

        // Remove the temporary message if there was an error
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: {
            chatInstanceId,
            messages: state.messages.filter((msg) => msg.id !== userMessage.id),
          },
        });
        throw new Error(`${errorType} error (${statusCode}): ${message}`);
      }

      // Clear any previous errors upon successful message send
      clearError();

      const data = await response.json();
      const { message } = data;

      const updatedMessages = [...state.messages, userMessage];

      saveConversationHistory(
        chatInstanceId,
        chatTitle || userMessage.text.slice(0, 50),
        updatedMessages,
        {
          id: user.id ?? "",
          email: user.email ?? "",
          name: user.name ?? "",
          image: user.image ?? "",
        }
      );

      setConversations((prev) => {
        const existing = prev.findIndex((c) => c.id === chatInstanceId);
        const newConversation: ChatHistoryItem = {
          id: chatInstanceId,
          title: chatTitle || userMessage.text.slice(0, 50),
          messages: updatedMessages,
          lastUpdated: new Date().toISOString(),
        };

        let updated;
        if (existing !== -1) {
          updated = [...prev];
          updated[existing] = newConversation;
        } else {
          updated = [newConversation, ...prev];
        }

        localStorage.setItem(
          `chat-conversations-${chatModelId}`,
          JSON.stringify(updated)
        );
        return updated;
      });
    } catch (error) {
      console.error("Error sending message:", error);
      showTemporaryToolState("Error", "error");

      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: {
          chatInstanceId,
          messages: state.messages.filter((msg) => msg.id !== userMessage.id),
        },
      });
    } finally {
      dispatch({
        type: ChatActionTypes.SET_LOADING,
        payload: { isLoading: false },
      });
    }
  };

  const updateChatTitle = useCallback(
    (newTitle: string, specificChatInstanceId?: string) => {
      const targetInstanceId = specificChatInstanceId || chatInstanceId;

      if (!targetInstanceId) {
        console.error(
          "[AI Smarttalk] No chat instance ID available for title update"
        );
        return;
      }

      // Update local state for the current chat instance
      if (targetInstanceId === chatInstanceId) {
        setChatTitle(newTitle);

        // Dispatch UPDATE_TITLE action to update the title in the reducer state
        dispatch({
          type: ChatActionTypes.UPDATE_TITLE,
          payload: {
            title: newTitle,
            chatInstanceId: targetInstanceId,
          },
        });
      }

      // Ensure conversations are properly loaded before updating
      if (conversations.length === 0) {
        try {
          const stored = localStorage.getItem(
            `chat-conversations-${chatModelId}`
          );
          if (stored) {
            const parsedConversations = JSON.parse(stored);
            setConversations(parsedConversations);
          }
        } catch (e) {
          console.error(
            "[AI Smarttalk] Error loading conversations from storage:",
            e
          );
        }
      }

      // First, make sure the title is updated in local storage history
      try {
        const storedHistory = loadConversationHistory(targetInstanceId);
        if (storedHistory && storedHistory.messages) {
          saveConversationHistory(
            targetInstanceId,
            newTitle,
            storedHistory.messages,
            {
              id: user.id ?? "",
              email: user.email ?? "",
              name: user.name ?? "",
              image: user.image ?? "",
            }
          );
        } else {
          // If we can't find conversation history but we have current messages
          if (
            targetInstanceId === chatInstanceId &&
            state.messages.length > 0
          ) {
            saveConversationHistory(
              targetInstanceId,
              newTitle,
              state.messages,
              {
                id: user.id ?? "",
                email: user.email ?? "",
                name: user.name ?? "",
                image: user.image ?? "",
              }
            );
          }
        }
      } catch (e) {
        console.error("[AI Smarttalk] Error updating conversation history:", e);
      }

      // Then update the conversations list
      setConversations((prev) => {
        const existingConversation = prev.find(
          (c) => c.id === targetInstanceId
        );

        if (!existingConversation) {
          // If conversation doesn't exist in list, create it
          const newConversationItem = {
            id: targetInstanceId,
            title: newTitle,
            messages: targetInstanceId === chatInstanceId ? state.messages : [],
            lastUpdated: new Date().toISOString(),
          };

          const updated = [newConversationItem, ...prev];

          // Save to localStorage
          localStorage.setItem(
            `chat-conversations-${chatModelId}`,
            JSON.stringify(updated)
          );

          return updated;
        } else {
          // Update existing conversation
          const updated = prev.map((conv) =>
            conv.id === targetInstanceId
              ? {
                  ...conv,
                  title: newTitle,
                  lastUpdated: new Date().toISOString(),
                }
              : conv
          );

          // Save to localStorage
          localStorage.setItem(
            `chat-conversations-${chatModelId}`,
            JSON.stringify(updated)
          );

          return updated;
        }
      });

      // Force a direct update to localStorage title as well
      localStorage.setItem(`chat-${targetInstanceId}-title`, newTitle);
    },
    [chatInstanceId, chatModelId, dispatch, conversations, state.messages]
  );

  const createNewChat = useCallback(async () => {
    try {
      const newInstanceId = await getNewInstance();

      if (!newInstanceId) {
        setError("Failed to create new chat instance");
        setErrorType("server");
        setErrorCode(500);
        console.error("Failed to create new chat instance");
        return null;
      }

      setChatInstanceId(newInstanceId);
      localStorage.setItem(storageKey, newInstanceId);

      // Reset initialization state for the new chat
      hasInitializedRef.current = true;

      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: { chatInstanceId: newInstanceId, messages: [] },
      });

      const defaultTitle = "💬 Nouvelle conversation";
      setChatTitle(defaultTitle);

      const newConversation: ChatHistoryItem = {
        id: newInstanceId,
        title: defaultTitle,
        messages: [],
        lastUpdated: new Date().toISOString(),
      };

      setConversations((prev) => {
        const updated = [newConversation, ...prev];
        localStorage.setItem(
          `chat-conversations-${chatModelId}`,
          JSON.stringify(updated)
        );
        return updated;
      });

      saveConversationHistory(newInstanceId, defaultTitle, [], {
        id: user.id ?? "",
        email: user.email ?? "",
        name: user.name ?? "",
        image: user.image ?? "",
      });

      // Clear any previous errors when creating a new chat successfully
      clearError();

      await new Promise((resolve) => setTimeout(resolve, 50));

      return newInstanceId;
    } catch (error) {
      console.error("Error creating new chat:", error);
      // Handle the error with detailed information for developers
      setError(
        error instanceof Error ? error.message : "Unknown error creating chat"
      );
      setErrorType("server");
      setErrorCode(error instanceof Response ? error.status : null);
      return null;
    }
  }, [chatModelId, dispatch, storageKey, clearError]);

  useEffect(() => {
    if (state.messages.length > 0) {
      const lastMessage = state.messages[state.messages.length - 1];
      if (
        lastMessage &&
        !lastMessage.isSent &&
        lastMessage.user?.id !== user.id &&
        lastMessage.user?.email !== user.email
      ) {
        setActiveTool(null);
        if (activeToolTimeoutRef.current) {
          clearTimeout(activeToolTimeoutRef.current);
          activeToolTimeoutRef.current = null;
        }
      }
    }
  }, [state.messages, user.id, user.email]);

  useEffect(() => {
    return () => {
      if (activeToolTimeoutRef.current) {
        clearTimeout(activeToolTimeoutRef.current);
      }
    };
  }, []);

  // When component mounts, try to load messages from localStorage
  useEffect(() => {
    if (chatInstanceId && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      
      // Skip loading if we already have messages in state
      if (state.messages.length > 0) {
        console.log('[AISmarttalk] Already have messages in state, skipping localStorage load:', state.messages.length);
        return;
      }
      
      // Load from localStorage
      const savedConversation = loadConversationHistory(chatInstanceId);
      
      if (savedConversation && savedConversation.messages && savedConversation.messages.length > 0) {
        // Cache messages for future use
        cachedMessagesRef.current[chatInstanceId] = savedConversation.messages;
        
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { 
            chatInstanceId, 
            messages: savedConversation.messages,
            userId: user?.id,
            userEmail: user?.email
          },
        });
      }
    }
  }, [chatInstanceId, user?.id, user?.email, state.messages.length]);

  const resetChat = useCallback(() => {
    try {
      if (chatInstanceId) {
        localStorage.removeItem(`chatMessages[${chatInstanceId}]`);
        
        // Clear cached messages for this instance
        if (cachedMessagesRef.current[chatInstanceId]) {
          delete cachedMessagesRef.current[chatInstanceId];
        }
        
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { 
            chatInstanceId,
            messages: [],
            resetMessages: true  // Explicitly mark as reset
          },
        });
        
        dispatch({
          type: ChatActionTypes.UPDATE_TITLE,
          payload: { title: "💬" },
        });
      }
    } catch (err) {
      console.error('[AISmartTalk] Error resetting chat:', err);
    }
  }, [chatInstanceId, dispatch]);

  return {
    messages: state.messages,
    notificationCount: state.notificationCount,
    suggestions: state.suggestions,
    // Enhanced error information for developers
    error: {
      message: error,
      type: errorType,
      code: errorCode,
    } as ChatError,
    clearError,
    setError: setApiError,
    setMessages: (messages: FrontChatMessage[]) =>
      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: { chatInstanceId, messages },
      }),
    setNotificationCount: (count: number) =>
      dispatch({
        type: ChatActionTypes.UPDATE_NOTIFICATION_COUNT,
        payload: { notificationCount: count },
      }),
    updateSuggestions: (suggestions: string[]) =>
      dispatch({
        type: ChatActionTypes.UPDATE_SUGGESTIONS,
        payload: { suggestions },
      }),
    addMessage,
    socketStatus,
    typingUsers,
    conversationStarters,
    activeTool,
    fetchMessagesFromApi,
    chatTitle,
    conversations,
    setConversations,
    saveConversationHistory: (messages: FrontChatMessage[], title: string) =>
      saveConversationHistory(chatInstanceId, title, messages, {
        id: user.id ?? "",
        email: user.email ?? "",
        name: user.name ?? "",
        image: user.image ?? "",
      }),
    canvas: canvasHistory.canvas,
    canvasHistory,
    isLoading: state.isLoading,
    onSend,
    selectConversation,
    updateChatTitle,
    chatInstanceId,
    getNewInstance,
    createNewChat,
    resetChat,
  };
};
