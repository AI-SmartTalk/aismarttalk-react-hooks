import { Dispatch, SetStateAction, useEffect } from 'react';
import socketIOClient from 'socket.io-client';
import { ChatActionTypes } from '../../reducers/chatReducers';
import { User } from '../../types/users';
import { CTADTO, FrontChatMessage } from '../../types/chat';
import { Tool } from '../../types/tools';
import { TypingUser } from '../../types/typingUsers';
import { saveConversationStarters, saveSuggestions } from '../../utils/localStorageHelpers';

export const useSocketHandler = (
  chatInstanceId: string,
  user: User,
  finalWsUrl: string,
  finalApiUrl: string,
  chatModelId: string,
  dispatch: Function,
  setSocketStatus: Dispatch<SetStateAction<string>>,
  setTypingUsers: Dispatch<SetStateAction<TypingUser[]>>,
  setConversationStarters: Dispatch<SetStateAction<CTADTO[]>>,
  setActiveTool: Dispatch<SetStateAction<Tool | null>>,
  setUser: (user: User) => void,
  fetchMessagesFromApi: () => void,
  debouncedTypingUsersUpdate: (data: TypingUser) => void,
) => {
  useEffect(() => {
    if(!chatInstanceId || !chatModelId || !finalApiUrl) return;
    
    const socket = socketIOClient(finalWsUrl, {
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      timeout: 20000,
      transports: ['polling', 'websocket'],
      upgrade: true,
      forceNew: true,
      rejectUnauthorized: false,
      transportOptions: { polling: { extraHeaders: { Origin: finalApiUrl } } },
    });

    socket.on('connect', () => {
      socket.emit('join', { chatInstanceId });
      setSocketStatus('connected');
      fetchMessagesFromApi();
    });

    socket.on('disconnect', (reason) => {
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
      }
    });

    socket.on('tool-run-start', (data: Tool) => setActiveTool(data));

    socket.on('connect_error', (err) => console.error('Socket connection error:', err));
    socket.on('reconnect_failed', () =>
      console.error('Socket reconnect failed:', { url: finalWsUrl })
    );

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [chatInstanceId, user, chatModelId, finalWsUrl, finalApiUrl, debouncedTypingUsersUpdate, fetchMessagesFromApi]);
}; 