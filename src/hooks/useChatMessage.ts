import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  ChatActionTypes,
  chatReducer,
  debounce,
  initialChatState,
} from "../reducers/chatReducers";
import { ChatHistoryItem, CTADTO, FrontChatMessage } from "../types/chat";
import { UseChatMessagesOptions } from "../types/chatConfig";
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
 * @returns {Object} Chat state and methods
 * @returns {FrontChatMessage[]} returns.messages - Array of chat messages
 * @returns {number} returns.notificationCount - Number of unread notifications
 * @returns {string[]} returns.suggestions - Message suggestions
 * @returns {string|null} returns.error - Error message if any
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
}: UseChatMessagesOptions) => {
  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalApiToken = config?.apiToken || "";
  const finalWsUrl = config?.wsUrl || defaultWsUrl;
  const storageKey = `chatInstanceId[${chatModelId}${isAdmin ? "-smartadmin" : "-standard"}]`;

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const { chatInstanceId, setChatInstanceId, getNewInstance } = useChatInstance(
    { chatModelId, lang, config, isAdmin: isAdmin }
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
  const activeToolTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const selectConversation = useCallback(
    async (id: string | undefined) => {
      try {
        if (!id) {
          await getNewInstance();
          return;
        }

        setChatInstanceId(id);
        localStorage.setItem(storageKey, id);

        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { chatInstanceId: id, messages: [] },
        });

        const response = await fetch(`${finalApiUrl}/api/chat/history/${id}`, {
          headers: finalApiToken
            ? { Authorization: `Bearer ${finalApiToken}` }
            : {},
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch messages: ${response.status}`);
        }

        const data = await response.json();

        const apiMessages = data.messages || [];
        if (apiMessages?.length > 0) {
          const currentUserId = data.connectedOrAnonymousUser?.id || user?.id;

          const processedMessages = apiMessages.map((message: any) => {
            const isUserMessage = message.userId === currentUserId;
            return {
              id: message.id,
              text: message.text,
              chatInstanceId: id,
              created_at: message.created_at,
              updated_at: message.updated_at,
              user: message.user,
              isSent: Boolean(isUserMessage),
            };
          });

          dispatch({
            type: ChatActionTypes.SET_MESSAGES,
            payload: { chatInstanceId: id, messages: processedMessages },
          });
        }
      } catch (error) {
        console.error("Error selecting conversation:", error);
        setError(error instanceof Error ? error.message : "Unknown error");
      }
    },
    [chatModelId, finalApiUrl, finalApiToken, storageKey]
  );

  useEffect(() => {
    if (chatInstanceId) return;

    if (isAdmin) return;

    const savedInstance = localStorage.getItem(storageKey);
    if (savedInstance) {
      selectConversation(savedInstance);
    } else {
      getNewInstance();
    }
  }, []);

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
    const currentInstanceId = chatInstanceId;
    if (!currentInstanceId) {
      return;
    }

    try {
      dispatch({
        type: ChatActionTypes.SET_LOADING,
        payload: { isLoading: true },
      });

      const response = await fetch(
        `${finalApiUrl}/api/chat/history/${currentInstanceId}`,
        {
          headers: finalApiToken
            ? { Authorization: `Bearer ${finalApiToken}` }
            : {},
        }
      );

      // If instance changed during fetch, abort to prevent flickering
      if (currentInstanceId !== chatInstanceId) {
        dispatch({
          type: ChatActionTypes.SET_LOADING,
          payload: { isLoading: false },
        });
        return;
      }

      if (response.status === 429) {
        setError("Trop de requêtes. Veuillez patienter avant de réessayer.");
        dispatch({
          type: ChatActionTypes.SET_LOADING,
          payload: { isLoading: false },
        });
        return;
      }

      const data = await response.json();

      // Double-check instance didn't change during JSON parsing
      if (currentInstanceId !== chatInstanceId) {
        dispatch({
          type: ChatActionTypes.SET_LOADING,
          payload: { isLoading: false },
        });
        return;
      }

      const apiMessages = data.messages || [];
      if (apiMessages?.length > 0) {
        const currentUserId =
          data.connectedOrAnonymousUser?.id || user?.id || "anonymous";

        const updatedMessages = apiMessages.map((message: any) => {
          const isUserMessage = message.userId === currentUserId;

          return {
            id: message.id,
            text: message.text,
            chatInstanceId: currentInstanceId,
            created_at: message.created_at,
            updated_at: message.updated_at,
            user: message.user,
            isSent: Boolean(isUserMessage),
          };
        });

        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: {
            chatInstanceId: currentInstanceId,
            messages: updatedMessages,
          },
        });
        setError(null);
      }
    } catch (err: any) {
      setError("Erreur lors de la récupération des messages : " + err.message);
      console.error(err);
    } finally {
      dispatch({
        type: ChatActionTypes.SET_LOADING,
        payload: { isLoading: false },
      });
    }
  }, [finalApiUrl, finalApiToken, chatInstanceId]);

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
    fetchMessagesFromApi,
    debouncedTypingUsersUpdate,
    canvasHistory,
    state.messages
  );

  useEffect(() => {
    if (!chatInstanceId) return;

    const history = loadConversationHistory(chatInstanceId);
    if (
      history &&
      Array.isArray(history.messages) &&
      history.messages.length > 0
    ) {
      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: {
          chatInstanceId,
          messages: history.messages,
          title: history.title || "",
        },
      });
      setChatTitle(history.title || "");

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
      fetchMessagesFromApi();
    }
  }, [chatInstanceId, fetchMessagesFromApi]);

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

  useEffect(() => {
    if (!chatInstanceId || !socketRef?.current) return;

    const shouldReconnect = socketStatus === "disconnected" && !isAdmin;

    if (shouldReconnect) {
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
  }, [chatInstanceId, socketStatus, isAdmin]);

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
      isSent: true,
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
        showTemporaryToolState("Error", "error");
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const { message } = data;

      const updatedMessages = [...state.messages, userMessage];

      saveConversationHistory(
        chatInstanceId,
        chatTitle || userMessage.text.slice(0, 50),
        updatedMessages
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
            storedHistory.messages
          );
        } else {
          // If we can't find conversation history but we have current messages
          if (
            targetInstanceId === chatInstanceId &&
            state.messages.length > 0
          ) {
            saveConversationHistory(targetInstanceId, newTitle, state.messages);
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
        console.error("Failed to create new chat instance");
        return null;
      }

      setChatInstanceId(newInstanceId);
      localStorage.setItem(storageKey, newInstanceId);

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

      saveConversationHistory(newInstanceId, defaultTitle, []);

      await new Promise((resolve) => setTimeout(resolve, 50));

      return newInstanceId;
    } catch (error) {
      console.error("Error creating new chat:", error);
      setError(error instanceof Error ? error.message : "Unknown error");
      return null;
    }
  }, [chatModelId, dispatch, storageKey]);

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

  return {
    messages: state.messages,
    notificationCount: state.notificationCount,
    suggestions: state.suggestions,
    error,
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
      saveConversationHistory(chatInstanceId, title, messages),
    canvas: canvasHistory.canvas,
    canvasHistory,
    isLoading: state.isLoading,
    onSend,
    selectConversation,
    updateChatTitle,
    chatInstanceId,
    getNewInstance,
    createNewChat,
  };
};
