import {
  Dispatch,
  SetStateAction,
  useEffect,
  useCallback,
  useRef,
} from "react";
import socketIOClient from "socket.io-client";
import { ChatActionTypes } from "../../reducers/chatReducers";
import { User } from "../../types/users";
import { CTADTO, FrontChatMessage } from "../../types/chat";
import { Tool } from "../../types/tools";
import { TypingUser } from "../../types/typingUsers";
import {
  saveConversationStarters,
  saveSuggestions,
} from "../../utils/localStorageHelpers";
import useCanvasHistory, { Canvas } from "../canva/useCanvasHistory";

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
): any => {
  const socketRef = useRef<any>(null);
  const currentInstanceRef = useRef<string>(chatInstanceId);

  const stableFetchMessages = useCallback(fetchMessagesFromApi, []);
  const stableTypingUpdate = useCallback(debouncedTypingUsersUpdate, []);

  // Force socket cleanup when instance changes
  useEffect(() => {
    if (currentInstanceRef.current !== chatInstanceId) {
      if (socketRef.current) {
        console.log('Forcing socket cleanup due to instance change', { 
          old: currentInstanceRef.current, 
          new: chatInstanceId 
        });
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      currentInstanceRef.current = chatInstanceId;
    }
  }, [chatInstanceId]);

  useEffect(() => {
    if (!chatInstanceId || !chatModelId || !finalApiUrl) {
      if (socketRef.current) {
        console.log('Cleaning up socket - missing dependencies');
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Always cleanup previous socket if it exists
    if (socketRef.current) {
      console.log('Cleaning up previous socket connection');
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    console.log('Creating new socket connection for instance:', chatInstanceId);
    const socket = socketIOClient(finalWsUrl, {
      query: {
        chatInstanceId,
        userId: user.id || "anonymous",
        userEmail: user.email || "anonymous@example.com",
        userName: user.name || "Anonymous",
      },
      forceNew: true,
      reconnection: false // Disable auto-reconnection
    });

    socketRef.current = socket;

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setSocketStatus("error");
    });

    socket.on("reconnect_failed", () => {
      console.error("Socket reconnect failed:", { url: finalWsUrl });
      setSocketStatus("failed");
    });

    socket.on("connect", () => {
      console.log('Socket connected, joining chat:', chatInstanceId);
      socket.emit("join", { chatInstanceId });
      setSocketStatus("connected");
      stableFetchMessages();
    });

    socket.on("disconnect", (reason) => {
      console.log('Socket disconnected:', reason);
      setSocketStatus("disconnected");
    });

    socket.on("chat-message", (data) => {
      if (data.chatInstanceId === chatInstanceId) {
        const isOwnMessage = data.message.user?.id === user.id ||
          (user.email && data.message.user?.email === user.email);

        if (!isOwnMessage) {
          dispatch({
            type: ChatActionTypes.ADD_MESSAGE,
            payload: {
              message: {
                ...data.message,
                isSent: false,
              },
              chatInstanceId,
              userId: user.id,
              userEmail: user.email,
            },
          });
        }
      }
    });

    socket.on("user-typing", (data: TypingUser) => {
      stableTypingUpdate(data);
    });

    socket.on("update-suggestions", (data) => {
      if (data.chatInstanceId === chatInstanceId) {
        saveSuggestions(chatInstanceId, data.suggestions);
        dispatch({
          type: ChatActionTypes.UPDATE_SUGGESTIONS,
          payload: { suggestions: data.suggestions },
        });
      }
    });

    socket.on("conversation-starters", (data) => {
      if (
        data.chatInstanceId === chatInstanceId &&
        data.conversationStarters?.length
      ) {
        setConversationStarters(data.conversationStarters);
        saveConversationStarters(chatModelId, data.conversationStarters);
      }
    });

    socket.on(
      "otp-login",
      (data: { chatInstanceId: string; user: User; token: string }) => {
        if (data.user && data.token) {
          const finalUser: User = { ...data.user, token: data.token };
          setUser(finalUser);
        }
      }
    );

    socket.on("tool-run-start", (data: Tool) => setActiveTool(data));

    socket.on("canvas:update", (canvas: Canvas) => {
      canvasHistory.updateCanvas(canvas);
    });

    socket.on(
      "canvas:line-update",
      ({
        start,
        end,
        lines,
      }: {
        start: number;
        end: number;
        lines: string[];
      }) => {
        canvasHistory.updateLineRange(start, end, lines);
      }
    );

    socket.on("reconnect_attempt", () => {
      console.log("[AI Smarttalk]  Attempting to reconnect...");
      setSocketStatus("connecting");
    });

    return () => {
      console.log('Cleaning up socket in useEffect cleanup');
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [chatInstanceId, chatModelId, finalWsUrl, user, finalApiUrl]);

  return socketRef;
};
