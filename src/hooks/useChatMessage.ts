import { useCallback, useEffect, useReducer, useState } from 'react';
import socketIOClient from 'socket.io-client';
import { FrontChatMessage } from '../types/chat';
import { User } from '../types/users';
import {
  ChatActionTypes,
  chatReducer,
  debounce,
  initialChatState,
} from '../reducers/chatReducers';
import { CTADTO } from '../types/chat';
import { TypingUser } from '../types/typingUsers';
import { Tool } from '../types/tools';
import {
  loadConversationHistory,
  loadConversationStarters,
  loadSuggestions,
  saveConversationHistory,
  saveConversationStarters,
  saveSuggestions,
} from '../utils/localStorageHelpers';
import { UseChatMessagesOptions } from '../types/chatConfig';

export interface ChatHistoryItem {
  id: string;
  title: string;
  messages: FrontChatMessage[];
  lastUpdated: string;
}

export const useChatMessages = ({
  chatInstanceId,
  isOpen,
  user,
  setUser,
  chatModelId, // Maintenant, c'est une propriété obligatoire hors config
  config,
}: UseChatMessagesOptions) => {
  // Extraction des valeurs de config pour les autres paramètres
  const {
    apiUrl = 'https://aismarttalk.tech',
    wsUrl = 'wss://ws.223.io.aismarttalk.tech',
    apiToken = '',
  } = config || {};

  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [socketStatus, setSocketStatus] = useState<string>('disconnected');
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [conversationStarters, setConversationStarters] = useState<CTADTO[]>([]);
  const [activeTool, setActiveTool] = useState<Tool | null>(null);
  const [chatTitle, setChatTitle] = useState<string>('');
  const [conversations, setConversations] = useState<ChatHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const debouncedTypingUsersUpdate = debounce((data: TypingUser) => {
    setTypingUsers((prev) => {
      const exists = prev.some((u) => u.userId === data.userId);
      if (data.isTyping) {
        return exists
          ? prev.map((u) => (u.userId === data.userId ? { ...u, isTyping: true } : u))
          : [...prev, data];
      }
      return prev.filter((u) => u.userId !== data.userId);
    });
  }, 500);

  useEffect(() => {
    if (state.messages.length > 0) setActiveTool(null);
  }, [state.messages]);

  const fetchMessagesFromApi = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/chat/history/${chatInstanceId}`, {
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
      });
      if (response.status === 429) {
        setError("Trop de requêtes. Veuillez patienter avant de réessayer.");
        return;
      }
      const { messages }: { messages: FrontChatMessage[] } = await response.json();
      if (messages.length > 0) {
        const updatedMessages = messages.map((message) => ({
          ...message,
          isSent: user.email?.includes('anonymous@')
            ? message.user?.email?.includes('anonymous@') ?? false
            : message.user?.email === user.email,
        }));
        dispatch({
          type: ChatActionTypes.SET_MESSAGES,
          payload: { chatInstanceId, messages: updatedMessages },
        });
        setError(null);
      }
    } catch (err: any) {
      setError("Erreur lors de la récupération des messages : " + err.message);
      console.error(err);
    }
  }, [apiUrl, apiToken, chatInstanceId, user.email]);

  useEffect(() => {
    if (!chatInstanceId) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchMessagesFromApi();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (document.visibilityState === 'visible') fetchMessagesFromApi();
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [chatInstanceId, fetchMessagesFromApi]);

  useEffect(() => {
    if (!chatInstanceId) return;
    const savedSuggestions = loadSuggestions(chatInstanceId);
    if (savedSuggestions.length > 0) {
      dispatch({ type: ChatActionTypes.UPDATE_SUGGESTIONS, payload: { suggestions: savedSuggestions } });
    }
    // Utilise chatModelId pour gérer les conversation starters
    const starters = loadConversationStarters(chatModelId);
    if (starters.length > 0) setConversationStarters(starters);
  }, [chatInstanceId, chatModelId]);

  useEffect(() => {
    if (!chatInstanceId) return;
    const socket = socketIOClient(wsUrl, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      timeout: 20000,
      transports: ['polling', 'websocket'],
      upgrade: true,
      forceNew: true,
      rejectUnauthorized: false,
      extraHeaders: { Origin: 'https://aismarttalk.tech' },
      transportOptions: { polling: { extraHeaders: { Origin: 'https://aismarttalk.tech' } } },
    });

    socket.on('connect', () => {
      socket.emit('join', { chatInstanceId });
      setSocketStatus('connected');
      fetchMessagesFromApi();
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setSocketStatus('disconnected');
    });

    socket.on('chat-message', (data) => {
      if (data.chatInstanceId === chatInstanceId) {
        const isOwnMessage = user.email?.includes('anonymous@')
          ? data.message.user?.email?.includes('anonymous@')
          : data.message.user?.id === user.id;
        if (!isOwnMessage) {
          dispatch({
            type: ChatActionTypes.ADD_MESSAGE,
            payload: { message: data.message, chatInstanceId, userEmail: user.email },
          });
        }
      }
    });

    socket.on('user-typing', (data: TypingUser) => {
      debouncedTypingUsersUpdate(data);
    });

    socket.on('update-suggestions', (data) => {
      if (data.chatInstanceId === chatInstanceId) {
        saveSuggestions(chatInstanceId, data.suggestions);
        dispatch({
          type: ChatActionTypes.UPDATE_SUGGESTIONS,
          payload: { suggestions: data.suggestions },
        });
      }
    });

    socket.on('conversation-starters', (data) => {
      if (data.chatInstanceId === chatInstanceId && data.conversationStarters?.length) {
        setConversationStarters(data.conversationStarters);
        saveConversationStarters(chatModelId, data.conversationStarters);
      }
    });

    socket.on('otp-login', (data: { chatInstanceId: string; user: User; token: string }) => {
      if (data.user && data.token) {
        const finalUser: User = { ...data.user, token: data.token };
        setUser(finalUser);
        console.log('User logged in:', finalUser.email);
      }
    });

    socket.on('tool-run-start', (data: Tool) => setActiveTool(data));

    socket.on('connect_error', (err) => console.error('Socket connection error:', err));
    socket.on('reconnect_failed', () =>
      console.error('Socket reconnect failed:', { url: wsUrl })
    );

    return () => {
      socket.disconnect();
      setSocketStatus('disconnected');
    };
  }, [chatInstanceId, user, wsUrl, chatModelId]);

  useEffect(() => {
    if (state.messages.length > 0 && !chatTitle) {
      const firstMessage = state.messages[0];
      setChatTitle(
        firstMessage.text.slice(0, 50) +
          (firstMessage.text.length > 50 ? '...' : '')
      );
    }
  }, [state.messages, chatTitle]);

  const resetChat = () => {
    if (!chatInstanceId) return;
    if (state.messages.length > 0) {
      saveConversationHistory(chatInstanceId, chatTitle || '', state.messages);
    }
    setChatTitle('💬');
    setActiveTool(null);
    dispatch({ type: ChatActionTypes.RESET_CHAT, payload: { chatInstanceId } });
    dispatch({ type: ChatActionTypes.UPDATE_NOTIFICATION_COUNT, payload: { notificationCount: 0 } });
  };

  const addMessage = (message: Partial<FrontChatMessage> & { text: string }) => {
    if (!chatInstanceId) return;
    const newMessage: FrontChatMessage = {
      id: message.id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: message.text,
      isSent: true,
      chatInstanceId,
      created_at: message.created_at || new Date().toISOString(),
      updated_at: message.updated_at || new Date().toISOString(),
      user: message.user || {
        id: user.id ?? '',
        email: user.email ?? '',
        name: user.name ?? '',
        image: user.image ?? '',
      },
    };

    if (chatTitle === '💬') {
      setChatTitle(
        newMessage.text.slice(0, 50) +
          (newMessage.text.length > 50 ? '...' : '')
      );
    }

    dispatch({
      type: ChatActionTypes.ADD_MESSAGE,
      payload: { message: newMessage, chatInstanceId, userEmail: user.email },
    });
    const updatedMessages = [...state.messages, newMessage];
    saveConversationHistory(chatInstanceId, chatTitle || '', updatedMessages);
  };

  const updateChatTitle = (newTitle: string) => {
    dispatch({ type: ChatActionTypes.UPDATE_TITLE, payload: { title: newTitle } });
    setChatTitle(newTitle);
    setConversations((prev) => {
      const existing = prev.findIndex((c) => c.id === chatInstanceId);
      if (existing !== -1) {
        const updated = [...prev];
        updated[existing] = { ...updated[existing], title: newTitle, lastUpdated: new Date().toISOString() };
        localStorage.setItem('chat-conversations', JSON.stringify(updated));
        return updated;
      }
      return prev;
    });
    if (state.messages.length > 0) {
      saveConversationHistory(chatInstanceId, newTitle, state.messages);
    }
  };

  useEffect(() => {
    if (!chatInstanceId) return;
    const history = loadConversationHistory(chatInstanceId);
    if (history) {
      dispatch({
        type: ChatActionTypes.SET_MESSAGES,
        payload: { chatInstanceId, messages: history.messages, title: history.title },
      });
    } else {
      fetchMessagesFromApi();
    }
  }, [chatInstanceId]);

  useEffect(() => {
    const stored = localStorage.getItem('chat-conversations');
    if (stored) {
      try {
        setConversations(JSON.parse(stored));
      } catch (e) {
        console.error('Error loading conversations:', e);
      }
    }
  }, []);

  return {
    messages: state.messages,
    notificationCount: state.notificationCount,
    suggestions: state.suggestions,
    error, // État d'erreur accessible par le composant parent
    setMessages: (messages: FrontChatMessage[]) =>
      dispatch({ type: ChatActionTypes.SET_MESSAGES, payload: { chatInstanceId, messages } }),
    setNotificationCount: (count: number) =>
      dispatch({ type: ChatActionTypes.UPDATE_NOTIFICATION_COUNT, payload: { notificationCount: count } }),
    updateSuggestions: (suggestions: string[]) =>
      dispatch({ type: ChatActionTypes.UPDATE_SUGGESTIONS, payload: { suggestions } }),
    addMessage,
    resetChat,
    socketStatus,
    typingUsers,
    conversationStarters,
    activeTool,
    fetchMessagesFromApi,
    chatTitle,
    updateChatTitle,
    conversations,
    setConversations,
    saveConversationHistory: (messages: FrontChatMessage[], title: string) =>
      saveConversationHistory(chatInstanceId, title, messages),
  };
};
