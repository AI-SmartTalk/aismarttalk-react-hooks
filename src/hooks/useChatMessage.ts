import { useCallback, useEffect, useReducer, useState, useRef } from "react";
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
}: UseChatMessagesOptions) => {
  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalApiToken = config?.apiToken || "";
  const finalWsUrl = config?.wsUrl || defaultWsUrl;

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [chatInstanceId, setChatInstanceId] = useState<string>("");
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

  const getNewInstance = async (newLang: string = lang) => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        appToken: finalApiToken,
      };

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers["Authorization"] = `Bearer ${user.token}`;
      }

      const response = await fetch(`${finalApiUrl}/api/chat/createInstance`, {
        method: "POST",
        headers,
        body: JSON.stringify({ chatModelId, lang: newLang }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create chat instance: ${response.status}`);
      }

      const data = await response.json();
      const newInstanceId = data.chatInstanceId;

      localStorage.setItem(`chatInstanceId[${chatModelId}]`, newInstanceId);
      setChatInstanceId(newInstanceId);
      dispatch({
        type: ChatActionTypes.RESET_CHAT,
        payload: { chatInstanceId: newInstanceId },
      });

      return newInstanceId;
    } catch (err) {
      console.error("Error creating new instance:", err);
      throw err;
    }
  };

  const selectConversation = useCallback(
    async (id: string | undefined) => {
      try {
        if (!id) {
          // Create new chat
          await getNewInstance();
          return;
        }

        // Update instance ID first
        setChatInstanceId(id);
        localStorage.setItem(`chatInstanceId[${chatModelId}]`, id);

        // Reset current messages
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { chatInstanceId: id, messages: [] },
        });

        // Load messages for this conversation
        const response = await fetch(`${finalApiUrl}/api/chat/history/${id}`, {
          headers: finalApiToken
            ? { Authorization: `Bearer ${finalApiToken}` }
            : {},
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch messages: ${response.status}`);
        }

        const data = await response.json();

        // IMPORTANT: Mettre à jour le user AVANT de traiter les messages
        if (data.connectedOrAnonymousUser) {
          setUser({
            ...user,
            id: data.connectedOrAnonymousUser.id,
            email: data.connectedOrAnonymousUser.email,
            name: data.connectedOrAnonymousUser.name,
            image: data.connectedOrAnonymousUser.image,
          });
          console.log(
            "User updated in selectConversation:",
            data.connectedOrAnonymousUser
          );
        }

        const apiMessages = data.messages || [];
        if (apiMessages?.length > 0) {
          const currentUserId = data.connectedOrAnonymousUser?.id || user?.id;
          console.log("Current user ID in selectConversation:", currentUserId);

          const processedMessages = apiMessages.map((message: any) => {
            const isUserMessage = message.userId === currentUserId;
            console.log(
              `Message ${message.id} - userId: ${message.userId}, isUserMessage: ${isUserMessage}`
            );

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
    [chatModelId, finalApiUrl, finalApiToken, getNewInstance]
  );

  // Initialize chat instance
  useEffect(() => {
    const savedInstance = localStorage.getItem(
      `chatInstanceId[${chatModelId}]`
    );
    if (savedInstance && !chatInstanceId) {
      // Only call selectConversation if chatInstanceId is empty
      selectConversation(savedInstance);
    } else if (!savedInstance && !chatInstanceId) {
      // Only create new instance if no saved instance and no current instance
      getNewInstance();
    }
    // Remove selectConversation from dependency array to prevent infinite loop
  }, [chatModelId, getNewInstance]);

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
    // Capture the current instance ID locally to ensure we're using the latest value
    const currentInstanceId = chatInstanceId;

    if (!currentInstanceId) {
      console.log("No chatInstanceId available, skipping fetch");
      return;
    }

    console.log(`Fetching messages for conversation: ${currentInstanceId}`);

    try {
      const response = await fetch(
        `${finalApiUrl}/api/chat/history/${currentInstanceId}`,
        {
          headers: finalApiToken
            ? { Authorization: `Bearer ${finalApiToken}` }
            : {},
        }
      );

      if (response.status === 429) {
        setError("Trop de requêtes. Veuillez patienter avant de réessayer.");
        return;
      }

      const data = await response.json();

      // Check if we're still on the same conversation
      if (currentInstanceId !== chatInstanceId) {
        console.log("Conversation changed during fetch, discarding results");
        return;
      }

      const apiMessages = data.messages || [];

      // Mettre à jour l'utilisateur avec les informations de l'API
      if (data.connectedOrAnonymousUser) {
        // Vérifier si l'utilisateur a changé avant de mettre à jour
        if (user?.id !== data.connectedOrAnonymousUser.id) {
          setUser({
            ...user,
            id: data.connectedOrAnonymousUser.id,
            email: data.connectedOrAnonymousUser.email,
            name: data.connectedOrAnonymousUser.name,
            image: data.connectedOrAnonymousUser.image,
          });

          console.log("User updated from API:", data.connectedOrAnonymousUser);
        }
      }

      if (apiMessages?.length > 0) {
        // Récupérer l'ID de l'utilisateur connecté depuis la réponse API
        const currentUserId =
          data.connectedOrAnonymousUser?.id || user?.id || "anonymous";

        console.log(
          "Current user ID:",
          currentUserId,
          "for conversation:",
          currentInstanceId
        );

        const updatedMessages = apiMessages.map((message: any) => {
          // Vérifier si ce message provient de l'utilisateur actuel
          const isUserMessage = message.userId === currentUserId;

          console.log(
            `Message ${message.id} - userId: ${message.userId}, isUserMessage: ${isUserMessage}`
          );

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
    canvasHistory
  );

  useEffect(() => {
    if (!chatInstanceId) return;

    const history = loadConversationHistory(chatInstanceId);
    if (history) {
      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: {
          chatInstanceId,
          messages: history.messages,
          title: history.title,
        },
      });
      setChatTitle(history.title);
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
    if (socketRef && socketRef.current && chatInstanceId) {
      console.log("Chat instance changed, reconnecting socket for:", chatInstanceId);
      
      try {
        if (socketRef.current.disconnect && typeof socketRef.current.disconnect === 'function') {
          socketRef.current.disconnect();
        }
        
        if (socketRef.current.connect && typeof socketRef.current.connect === 'function') {
          socketRef.current.connect();
        }
      } catch (err) {
        console.error("Error reconnecting socket:", err);
      }
    }
  }, [chatInstanceId]);

  const dismissActiveTool = useCallback((delay = 5000) => {
    if (activeToolTimeoutRef.current) {
      clearTimeout(activeToolTimeoutRef.current);
    }
    
    activeToolTimeoutRef.current = setTimeout(() => {
      setActiveTool(null);
      activeToolTimeoutRef.current = null;
    }, delay);
  }, []);

  const showTemporaryToolState = useCallback((state: string, icon?: string) => {
    setActiveTool({
      id: `temp-${state}-${Date.now()}`,
      name: state,
      icon: icon || "status",
      type: "status"
    } as Tool);
    dismissActiveTool();
  }, [dismissActiveTool]);

  const onSend = async (messageText: string) => {
    if (state.isLoading || !chatInstanceId) return;
    dispatch({
      type: ChatActionTypes.SET_LOADING,
      payload: { isLoading: true },
    });

    showTemporaryToolState("Sending...", "loading");

    const userMessage: FrontChatMessage = {
      id: `temp-${Date.now()}`,
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

      const options = {
        url: `${finalApiUrl}/api/chat`,
        headers: headers,
        data: {
          message: messageText,
          messages: [...state.messages, userMessage],
          chatInstanceId,
          chatModelId: chatModelId,
          lang: "fr",
        },
      };

      const response = await fetch(options.url, {
        method: "POST",
        headers: options.headers,
        body: JSON.stringify(options.data),
      });

      if (!response.ok) {
        showTemporaryToolState("Error", "error");
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const { message } = data;

      if (message && message.id !== userMessage.id) {
        const updatedMessages = [...state.messages, userMessage];

        // Save to conversation history with current chatInstanceId
        saveConversationHistory(
          chatInstanceId,
          chatTitle || "",
          updatedMessages
        );

        // Update conversations list
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
      }
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
      // Use the specified ID if provided, otherwise use current ID
      const targetInstanceId = specificChatInstanceId || chatInstanceId;
      
      if (!targetInstanceId) {
        console.error("No chat instance ID available for title update");
        return;
      }
      
      console.log(`Updating title for chat instance: ${targetInstanceId} to "${newTitle}"`);
      
      // Only update current title if we're updating the active conversation
      if (targetInstanceId === chatInstanceId) {
        setChatTitle(newTitle);
      }

      // Update conversations list with new title
      setConversations((prev) => {
        const updated = prev.map((conv) =>
          conv.id === targetInstanceId ? { ...conv, title: newTitle } : conv
        );
        localStorage.setItem(
          `chat-conversations-${chatModelId}`,
          JSON.stringify(updated)
        );
        return updated;
      });

      // Find the conversation to update in local storage
      const conversationToUpdate = conversations.find(conv => conv.id === targetInstanceId);
      if (conversationToUpdate) {
        // Update conversation history with new title
        saveConversationHistory(
          targetInstanceId, 
          newTitle, 
          conversationToUpdate.messages || [] // Use messages from the specific conversation
        );
      }
    },
    [chatInstanceId, chatModelId, conversations]
  );

  // Fix pour le problème de fetch d'historique API lors de la création d'un nouveau chat
  const createNewChat = useCallback(async () => {
    try {
      // Créer une nouvelle instance
      const newInstanceId = await getNewInstance();
      
      if (!newInstanceId) {
        console.error("Failed to create new chat instance");
        return null;
      }
      
      // Mise à jour explicite du chatInstanceId pour éviter les confusions
      setChatInstanceId(newInstanceId);
      localStorage.setItem(`chatInstanceId[${chatModelId}]`, newInstanceId);
      
      // Réinitialisation immédiate des messages dans l'état
      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: { chatInstanceId: newInstanceId, messages: [] },
      });
      
      // Définir un titre par défaut
      const defaultTitle = "💬 Nouvelle conversation";
      setChatTitle(defaultTitle);
      
      // Créer un objet conversation pour l'historique
      const newConversation: ChatHistoryItem = {
        id: newInstanceId,
        title: defaultTitle,
        messages: [],
        lastUpdated: new Date().toISOString(),
      };
      
      // Ajouter à la liste des conversations
      setConversations((prev) => {
        const updated = [newConversation, ...prev];
        localStorage.setItem(
          `chat-conversations-${chatModelId}`,
          JSON.stringify(updated)
        );
        return updated;
      });
      
      // Sauvegarder dans l'historique local avec tableau vide explicite
      saveConversationHistory(newInstanceId, defaultTitle, []);
      
      console.log(`Created new chat instance: ${newInstanceId}`);
      
      // Petit délai pour s'assurer que les états sont mis à jour
      await new Promise(resolve => setTimeout(resolve, 50));
      
      return newInstanceId;
    } catch (error) {
      console.error("Error creating new chat:", error);
      setError(error instanceof Error ? error.message : "Unknown error");
      return null;
    }
  }, [getNewInstance, chatModelId, dispatch, setChatInstanceId]);

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
