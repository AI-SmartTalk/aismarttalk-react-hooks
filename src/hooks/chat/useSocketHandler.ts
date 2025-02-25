import { Dispatch, SetStateAction, useEffect, useCallback } from 'react';
import socketIOClient from 'socket.io-client';
import { ChatActionTypes } from '../../reducers/chatReducers';
import { User } from '../../types/users';
import { CTADTO, FrontChatMessage } from '../../types/chat';
import { Tool } from '../../types/tools';
import { TypingUser } from '../../types/typingUsers';
import { saveConversationStarters, saveSuggestions } from '../../utils/localStorageHelpers';
import useCanvasHistory, { Canvas } from '../canva/useCanvasHistory';

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
  canvasHistory: ReturnType<typeof useCanvasHistory>
) => {
  // Create stable references to callback functions
  const stableFetchMessages = useCallback(fetchMessagesFromApi, []);
  const stableTypingUpdate = useCallback(debouncedTypingUsersUpdate, []);

  useEffect(() => {
    if(!chatInstanceId || !chatModelId || !finalApiUrl) return;

    // Create socket with stable config
    const socket = socketIOClient(finalWsUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      timeout: 20000,
      transports: ['polling', 'websocket'], // Try polling first, then websocket
      upgrade: true,
      forceNew: false,
      rejectUnauthorized: false,
      reconnection: true,
      reconnectionDelayMax: 5000,
      autoConnect: true
    });

    // Add error handling
    socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err);
      setSocketStatus('error');
    });

    socket.on('reconnect_failed', () => {
      console.error('Socket reconnect failed:', { url: finalWsUrl });
      setSocketStatus('failed');
    });

    socket.on('connect', () => {
      socket.emit('join', { chatInstanceId });
      setSocketStatus('connected');
      stableFetchMessages();
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
      stableTypingUpdate(data);
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

    socket.on('canvas:update', (canvas: Canvas) => {
      canvasHistory.updateCanvas(canvas);
    });

    socket.on('canvas:line-update', ({ start, end, lines }: { 
      start: number;
      end: number;
      lines: string[];
    }) => {
      canvasHistory.updateLineRange(start, end, lines);
    });

    // Add reconnect event handler
    socket.on('reconnect_attempt', () => {
      console.log('Attempting to reconnect...');
      setSocketStatus('connecting');
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [chatInstanceId, chatModelId, finalWsUrl]); // Keep minimal dependencies
}; 