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
import { useFileUpload } from "./fileUpload/useFileUpload";

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
  console.log('config', config);
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

  const messagesCountRef = useRef<number>(0);

  useEffect(() => {
    messagesCountRef.current = state.messages.length;
  }, [state.messages.length]);

  useEffect(() => {
    if (chatInstanceId && chatInstanceId !== previousChatInstanceRef.current) {
      // First clear the current state and note the change
      const prevInstance = previousChatInstanceRef.current;
      previousChatInstanceRef.current = chatInstanceId;

      // Reset message state when switching to a different conversation
      if (prevInstance) {
        // This is a conversation switch - reset messages
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { 
            chatInstanceId: chatInstanceId, 
            messages: [],
            resetMessages: true
          },
        });
        
        // Return early - let the selectConversation function handle loading messages
        return;
      }
      
      // Only for initial load or non-conversation switching cases:
      // Try to load from cache if available
      if (cachedMessagesRef.current[chatInstanceId]?.length > 0) {
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { 
            chatInstanceId: chatInstanceId, 
            messages: cachedMessagesRef.current[chatInstanceId],
            userId: user?.id || 'anonymous',
            userEmail: user?.email
          },
        });
      }
    }
  }, [chatInstanceId, dispatch, user?.id, user?.email]);

  useEffect(() => {
    if (chatInstanceId && state.messages.length > 0) {
      cachedMessagesRef.current[chatInstanceId] = state.messages;
    }
  }, [chatInstanceId, state.messages]);

  const clearCachedMessages = useCallback((instanceId: string) => {
    if (cachedMessagesRef.current[instanceId]) {
      delete cachedMessagesRef.current[instanceId];
    }
  }, []);

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

  const strictlyFilterMessagesByInstance = (
    messages: FrontChatMessage[],
    targetChatInstanceId: string
  ): FrontChatMessage[] => {
    return messages.filter(message => message.chatInstanceId === targetChatInstanceId);
  };

  // Canvas management with useCanvasHistory
  const canvasHistory = useCanvasHistory(chatModelId, chatInstanceId);

  // Fetch canvases from API
  const fetchCanvases = useCallback(async (): Promise<void> => {
    if (!chatInstanceId) return;

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
        `${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`,
        {
          method: 'GET',
          headers,
        }
      );

      if (!response.ok) {
        let errorMessage = `Failed to fetch canvases (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          try {
            const textError = await response.text();
            if (textError) {
              errorMessage = textError;
            }
          } catch {
            // Keep default error message
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log("Fetched canvases", data);
      
      // Update canvases through useCanvasHistory
      canvasHistory.setCanvasesFromAPI(data);
      
      // Also update the reducer state for backward compatibility
      dispatch({
        type: ChatActionTypes.SET_CANVASES,
        payload: { canvases: data },
      });
      
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch canvases';
      console.error("Error fetching canvases:", errorMessage);
    }
  }, [chatInstanceId, finalApiUrl, finalApiToken, user?.token, chatModelId, canvasHistory]);

  // Initialize canvas fetching
  useEffect(() => {
    if (chatInstanceId) {
      fetchCanvases();
    }
  }, [chatInstanceId, fetchCanvases]);

  const selectConversation = useCallback(
    async (id: string | undefined) => {
      try {
        if (!id) {
          await getNewInstance();
          return;
        }

        if (id === chatInstanceId) {
          // Si on sélectionne la conversation actuelle, ne rien faire
          return;
        }

        clearError();
        
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { 
            chatInstanceId: id, 
            messages: [],
            resetMessages: true
          },
        });
          
        clearCachedMessages(id);
        
        setChatInstanceId(id);
        localStorage.setItem(storageKey, id);

        // Marquer comme initialisé pour empêcher les appels API à répétition
        hasInitializedRef.current = false;

        try {
          const existingConversation = conversations.find(conv => conv.id === id);
          
          if (existingConversation && existingConversation.messages && existingConversation.messages.length > 0) {
            const strictMessages = strictlyFilterMessagesByInstance(existingConversation.messages, id);
            
            if (strictMessages.length > 0) {
              dispatch({
                type: ChatActionTypes.SET_MESSAGES,
                payload: { 
                  chatInstanceId: id, 
                  messages: strictMessages,
                  userId: user?.id || 'anonymous',
                  userEmail: user?.email,
                  resetMessages: true
                },
              });
              
              if (existingConversation.title) {
                setChatTitle(existingConversation.title);
              }
              
              cachedMessagesRef.current[id] = strictMessages;
              hasInitializedRef.current = true;
              return;
            }
          }
          
          const savedConversation = loadConversationHistory(id);
          if (savedConversation?.messages && savedConversation.messages.length > 0) {
            const strictMessages = strictlyFilterMessagesByInstance(savedConversation.messages, id);
            
            if (strictMessages.length > 0) {
              dispatch({
                type: ChatActionTypes.SET_MESSAGES,
                payload: { 
                  chatInstanceId: id, 
                  messages: strictMessages,
                  userId: user?.id || 'anonymous',
                  userEmail: user?.email,
                  resetMessages: true
                },
              });
              
              if (savedConversation.title) {
                setChatTitle(savedConversation.title);
              }
              
              cachedMessagesRef.current[id] = strictMessages;
              hasInitializedRef.current = true;
              return;
            }
          }
          
          // Uniquement appeler l'API s'il n'y a pas de données en cache
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

          const data = await response.json();
          const apiMessages = data.messages || [];
          
          if (apiMessages?.length > 0) {
            const currentUserId = data.connectedOrAnonymousUser?.id || user?.id || 'anonymous';
            const currentUserEmail = data.connectedOrAnonymousUser?.email || user?.email;

            const processedMessages = apiMessages.map((message: any) => ({
              id: message.id,
              text: message.text,
              chatInstanceId: id,
              created_at: message.created_at,
              updated_at: message.updated_at,
              user: message.user || { id: 'anonymous' },
              isSent: shouldMessageBeSent(
                message,
                currentUserId,
                currentUserEmail
              ),
            }));

            dispatch({
              type: ChatActionTypes.SET_MESSAGES,
              payload: { 
                chatInstanceId: id, 
                messages: processedMessages,
                userId: currentUserId,
                userEmail: currentUserEmail,
                resetMessages: true
              },
            });
            
            cachedMessagesRef.current[id] = processedMessages;
            
            if (data.title) {
              setChatTitle(data.title);
            }
          } else {
            dispatch({
              type: ChatActionTypes.SET_MESSAGES,
              payload: { 
                chatInstanceId: id, 
                messages: [],
                resetMessages: true
              },
            });
          }
          hasInitializedRef.current = true;
        } catch (error) {
          console.error("Error fetching conversation:", error);
          dispatch({
            type: ChatActionTypes.SET_MESSAGES,
            payload: { 
              chatInstanceId: id, 
              messages: [],
              resetMessages: true
            },
          });
          hasInitializedRef.current = true;
        }
      } catch (error) {
        console.error("Error selecting conversation:", error);
        setError(
          error instanceof Error
            ? error.message
            : "Unknown error selecting conversation"
        );
        setErrorType("network");
        setErrorCode(null);
        hasInitializedRef.current = true;
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
      clearCachedMessages,
      setChatTitle,
      conversations,
      chatInstanceId
    ]
  );

  useEffect(() => {
    if (chatInstanceId) return;
    if (isAdmin) return;

    const savedInstance = localStorage.getItem(storageKey);
    if (savedInstance) {
      setChatInstanceId(savedInstance);
    } else {
      getNewInstance();
    }
  }, []);
  useEffect(() => {
    if (!chatInstanceId) return;

    hasInitializedRef.current = false;

    const history = loadConversationHistory(chatInstanceId);
    if (history.messages.length > 0) {
      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: {
          chatInstanceId,
          messages: history.messages,
          title: history.title || "",
        },
      });
      setChatTitle(history.title || "");

      hasInitializedRef.current = true;

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
  }, [chatInstanceId]);
  
  // Separate useEffect for loading conversations from localStorage - run only once
  useEffect(() => {
    const loadConversationsFromStorage = () => {
      const stored = localStorage.getItem(`chat-conversations-${chatModelId}`);
      if (!stored) return;
      
      try {
        let parsedConversations = JSON.parse(stored);
        
        // Ensure all conversations have proper ownership information
        parsedConversations = parsedConversations.map((conv: any) => {
          if (conv.messages && conv.messages.length > 0) {
            const hasOwner = conv.messages.some((msg: any) => 
              msg.user && (msg.user.id === 'anonymous' || msg.user.id === user?.id)
            );
            
            if (!hasOwner) {
              const ownerMessage = {
                id: `system-owner-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
                text: "Conversation ownership",
                isSent: true,
                chatInstanceId: conv.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                user: {
                  id: user?.id || 'anonymous',
                  email: user?.email || '',
                  name: user?.name || 'User',
                  image: user?.image || ''
                }
              };
              
              return {
                ...conv,
                messages: [ownerMessage, ...conv.messages]
              };
            }
          }
          
          return conv;
        });
        
        // Filter out conversations where the user hasn't sent any messages
        parsedConversations = parsedConversations.filter((conv: any) => {
          if (!conv.messages || conv.messages.length === 0) {
            return false;
          }
          
          return conv.messages.some((msg: any) => 
            msg.isSent === true && 
            msg.user && 
            (msg.user.id === user?.id || msg.user.id === 'anonymous')
          );
        });
        
        setConversations(parsedConversations);
      } catch (e) {
        console.error("Error loading conversations:", e);
      }
    };
    
    // Load conversations only once at initialization
    const initialLoadTimeout = setTimeout(() => {
      loadConversationsFromStorage();
    }, 0);
    
    return () => clearTimeout(initialLoadTimeout);
  }, []); // Run only once when the component mounts

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

    if (hasInitializedRef.current) {
      return;
    }

    // Marquer comme initialisé AVANT l'appel API pour éviter les appels multiples
    hasInitializedRef.current = true;

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

        cachedMessagesRef.current[currentInstanceId] = processedMessages;

        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: {
            chatInstanceId: currentInstanceId,
            messages: processedMessages,
            userId: currentUserId,
            userEmail: data.connectedOrAnonymousUser?.email || user?.email,
          },
        });

        if (data.title) {
          setChatTitle(data.title);
        }
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
      setApiError(
        error instanceof Error
          ? error.message
          : "Unknown error fetching messages",
        "network"
      );
    }
  }, [
    chatInstanceId,
    finalApiUrl,
    finalApiToken,
    user,
    handleApiError,
    clearError,
    setApiError,
    setChatTitle,
    dispatch
  ]);

  const { addMessage } = useMessageHandler(
    chatInstanceId,
    user,
    dispatch,
    chatTitle,
    setChatTitle,
    state.messages
  );

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

  const { uploadFile, isUploading } = useFileUpload({
    chatModelId, 
    chatInstanceId, 
    user, 
    config,
    onUploadSuccess: (data) => {
      console.log("File uploaded successfully:", data);
      // Refresh canvases after successful upload
      fetchCanvases();
    },
    onUploadError: (error) => {
      console.error("File upload error:", error);
    }
  });

  useEffect(() => {
    if (!chatInstanceId || !socketRef?.current) return;

    const shouldReconnect =
      socketStatus === "disconnected" && !isAdmin;

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

    const messageId = `temp-${user.id || "anonymous"}-${Date.now()}`;

    const userMessage: FrontChatMessage = {
      id: messageId,
      text: messageText,
      isSent: true,
      chatInstanceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      isLocallyCreated: true,
      user: {
        id: user.id ?? "",
        email: user.email ?? "",
        name: user.name ?? "",
        image: user.image ?? "",
      },
    };

    if (socketRef.current) {
      const now = Date.now();
      socketRef.current._lastMessageTime = now;
      if (socketRef.current.lastMessageReceivedRef) {
        socketRef.current.lastMessageReceivedRef.current = now;
      }
    }

    // Add the message to history immediately
    dispatch({
      type: ChatActionTypes.ADD_MESSAGE,
      payload: { 
        message: userMessage, 
        chatInstanceId, 
        userId: user.id,
        userEmail: user.email 
      },
    });

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
            messages: state.messages,
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
        const { message, errorType, statusCode } = handleApiError(
          response.status,
          `Error sending message: ${response.status}`
        );
        
        throw new Error(`${errorType} error (${statusCode}): ${message}`);
      }

      clearError();

      const data = await response.json();
      
      // Check if we got an AI response from the API and add it to history
      if (data.message) {
        // Add the AI response to history
        dispatch({
          type: ChatActionTypes.ADD_MESSAGE,
          payload: { 
            message: {
              ...data.message,
              isLocallyCreated: true,
            }, 
            chatInstanceId 
          },
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
      showTemporaryToolState("Error", "error");
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

      if (targetInstanceId === chatInstanceId) {
        setChatTitle(newTitle);

        dispatch({
          type: ChatActionTypes.UPDATE_TITLE,
          payload: {
            title: newTitle,
            chatInstanceId: targetInstanceId,
          },
        });
      }

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

      try {
        const storedHistory = loadConversationHistory(targetInstanceId);
        const messagesForUpdate = targetInstanceId === chatInstanceId && state.messages.length > 0 
          ? state.messages 
          : storedHistory.messages;
        
        // Only update if there are messages and at least one is from the user
        if (messagesForUpdate.length > 0) {
          const userHasSentMessage = messagesForUpdate.some(msg => 
            msg.isSent === true && 
            msg.user && 
            (msg.user.id === user.id || msg.user.id === 'anonymous')
          );
          
          if (userHasSentMessage) {
            saveConversationHistory(
              targetInstanceId,
              newTitle,
              messagesForUpdate,
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

      setConversations((prev) => {
        const existingConversation = prev.find(
          (c) => c.id === targetInstanceId
        );
        
        const targetMessages = targetInstanceId === chatInstanceId ? state.messages : 
          (existingConversation?.messages || []);
        
        // Only update if user has sent at least one message
        const userHasSentMessage = targetMessages.some(msg => 
          msg.isSent === true && 
          msg.user && 
          (msg.user.id === user.id || msg.user.id === 'anonymous')
        );
        
        if (!userHasSentMessage && targetMessages.length > 0) {
          return prev; // Don't update if no user message
        }

        if (!existingConversation) {
          // Only add conversation if it has user messages
          if (!userHasSentMessage && targetMessages.length > 0) {
            return prev;
          }
          
          const newConversationItem = {
            id: targetInstanceId,
            title: newTitle,
            messages: targetMessages,
            lastUpdated: new Date().toISOString(),
          };

          const updated = [newConversationItem, ...prev];

          localStorage.setItem(
            `chat-conversations-${chatModelId}`,
            JSON.stringify(updated)
          );

          return updated;
        } else {
          const updated = prev.map((conv) =>
            conv.id === targetInstanceId
              ? {
                  ...conv,
                  title: newTitle,
                  lastUpdated: new Date().toISOString(),
                }
              : conv
          );

          localStorage.setItem(
            `chat-conversations-${chatModelId}`,
            JSON.stringify(updated)
          );

          return updated;
        }
      });

      localStorage.setItem(`chat-${targetInstanceId}-title`, newTitle);
    },
    [chatInstanceId, chatModelId, dispatch, conversations, state.messages]
  );

  const createNewChat = useCallback(async () => {
    try {
      const newInstanceId = await getNewInstance();
      if (!newInstanceId) return null;

      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: { 
          chatInstanceId: newInstanceId, 
          messages: [],
          resetMessages: true
        },
      });

      clearCachedMessages(newInstanceId);
      const defaultTitle = "💬 Nouvelle conversation";
      setChatTitle(defaultTitle);

      // Save the conversation with the proper user directly
      saveConversationHistory(
        newInstanceId,
        defaultTitle,
        [], // No need for initial system message
        {
          id: user.id || 'anonymous',
          email: user.email || '',
          name: user.name || 'User',
          image: user.image || ''
        }
      );

      // Add to conversations list without the system message
      const newConversation = {
        id: newInstanceId,
        title: defaultTitle,
        messages: [], // Start with an empty array of messages
        lastUpdated: new Date().toISOString(),
        user: {
          id: user.id || 'anonymous',
          email: user.email || '',
          name: user.name || 'User',
          image: user.image || ''
        }
      };

      setConversations((prev) => {
        const updated = [newConversation, ...prev];
        localStorage.setItem(
          `chat-conversations-${chatModelId}`,
          JSON.stringify(updated)
        );
        return updated;
      });

      return newInstanceId;
    } catch (error) {
      return null;
    }
  }, [
    chatModelId, 
    dispatch, 
    storageKey, 
    chatInstanceId, 
    getNewInstance, 
    setChatTitle, 
    clearCachedMessages,
    user.id,
    user.email,
    user.name,
    user.image
  ]);

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

  useEffect(() => {
    if (chatInstanceId && !hasInitializedRef.current) {
      hasInitializedRef.current = true;

      if (state.messages.length > 0) {
        return;
      }

      const savedConversation = loadConversationHistory(chatInstanceId);

      // Only load from localStorage if we have messages
      if (savedConversation.messages.length > 0) {
        cachedMessagesRef.current[chatInstanceId] = savedConversation.messages;

        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: {
            chatInstanceId,
            messages: savedConversation.messages,
            userId: user?.id || 'anonymous',
            userEmail: user?.email
          },
        });
        
        // Also update the title if available
        if (savedConversation.title) {
          setChatTitle(savedConversation.title);
        }
      }
    }
  }, [chatInstanceId, user?.id, user?.email, state.messages.length, setChatTitle]);

  const resetChat = useCallback(() => {
    try {
      if (chatInstanceId) {
        localStorage.removeItem(`chatMessages[${chatInstanceId}]`);

        if (cachedMessagesRef.current[chatInstanceId]) {
          delete cachedMessagesRef.current[chatInstanceId];
        }

        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: {
            chatInstanceId,
            messages: [],
            resetMessages: true,
          },
        });

        dispatch({
          type: ChatActionTypes.UPDATE_TITLE,
          payload: { title: "💬" },
        });
      }
    } catch (err) {
      console.error("[AISmartTalk] Error resetting chat:", err);
    }
  }, [chatInstanceId, dispatch]);

  return {
    messages: state.messages,
    notificationCount: state.notificationCount,
    suggestions: state.suggestions,
    canvases: state.canvases,
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
    saveConversationHistory: (messages: FrontChatMessage[], title: string) => {
      // Don't save empty conversations to history
      if (!messages || messages.length === 0) {
        return;
      }
      
      // Only save if the user has sent at least one message
      const userHasSentMessage = messages.some(msg => 
        msg.isSent === true && 
        msg.user && 
        (msg.user.id === user.id || msg.user.id === 'anonymous')
      );
      
      if (userHasSentMessage) {
        saveConversationHistory(chatInstanceId, title, messages, {
          id: user.id ?? "",
          email: user.email ?? "",
          name: user.name ?? "",
          image: user.image ?? "",
        });
      }
    },
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
    uploadFile,
    isUploading,
  };
};
