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
import { defaultApiUrl, defaultWsUrl } from '../types/config';
import { useSocketHandler } from './chat/useSocketHandler';
import { useMessageHandler } from './chat/useMessageHandler';

export interface ChatHistoryItem {
  id: string;
  title: string;
  messages: FrontChatMessage[];
  lastUpdated: string;
}

/**
 * Custom hook for managing chat messages and related functionality
 * @param {Object} options - The configuration options for the chat
 * @param {string} options.chatInstanceId - Unique identifier for the chat instance
 * @param {User} options.user - Current user information
 * @param {Function} options.setUser - Function to update user information
 * @param {string} options.chatModelId - Identifier for the chat model being used
 * @param {Object} options.config - Additional configuration options
 * @param {string} [options.config.apiUrl] - API endpoint URL
 * @param {string} [options.config.wsUrl] - WebSocket server URL
 * @param {string} [options.config.apiToken] - Authentication token for API requests
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
 */
export const useChatMessages = ({
  chatInstanceId,
  user,
  setUser,
  chatModelId,
  config,
}: UseChatMessagesOptions) => {
  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalWsUrl = config?.wsUrl || defaultWsUrl;
  const finalApiToken = config?.apiToken || '';

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
      const response = await fetch(`${finalApiUrl}/api/chat/history/${chatInstanceId}`, {
        headers: finalApiToken ? { Authorization: `Bearer ${finalApiToken}` } : {},
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
  }, [finalApiUrl, finalApiToken, chatInstanceId, user.email]);

  const { addMessage } = useMessageHandler(
    chatInstanceId,
    user,
    dispatch,
    chatTitle,
    setChatTitle,
    state.messages
  );


  const socket = useSocketHandler(
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
    debouncedTypingUsersUpdate
  );

   

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
    error,
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
