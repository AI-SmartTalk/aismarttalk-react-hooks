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
import { initialUser } from "../../hooks/useUser";
import { CTADTO, FrontChatMessage } from "../../types/chat";
import { Tool } from "../../types/tools";
import { TypingUser } from "../../types/typingUsers";
import {
  saveConversationStarters,
  saveSuggestions,
} from "../../utils/localStorageHelpers";
import useCanvasHistory, { Canvas } from "../canva/useCanvasHistory";
import { isMessageDuplicate } from "../../utils/messageUtils";

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
  canvasHistory: ReturnType<typeof useCanvasHistory>,
  messages: FrontChatMessage[]
): any => {
  const socketRef = useRef<any>(null);
  const currentInstanceRef = useRef<string>(chatInstanceId);
  const lastMessageReceivedRef = useRef<number>(0);

  const stableTypingUpdate = useCallback(debouncedTypingUsersUpdate, []);

  // Force socket cleanup when instance changes
  useEffect(() => {
    if (currentInstanceRef.current !== chatInstanceId) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      currentInstanceRef.current = chatInstanceId;
      lastMessageReceivedRef.current = 0;
    }
  }, [chatInstanceId]);

  useEffect(() => {
    if (!chatInstanceId || !chatModelId || !finalApiUrl) {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Always cleanup previous socket if it exists
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Set initial value of lastMessageReceivedRef to now, to prevent immediate API fetches
    lastMessageReceivedRef.current = Date.now();

    const socket = socketIOClient(finalWsUrl, {
      query: {
        chatInstanceId,
        userId: user.id || initialUser.id,
        userEmail: user.email || initialUser.email,
        userName: user.name || initialUser.name,
      },
      forceNew: true,
      reconnection: false, // Disable auto-reconnection
      timeout: 20000,
    });

    socketRef.current = socket;
    socketRef.current._lastMessageTime = lastMessageReceivedRef.current;
    socketRef.current.lastMessageReceivedRef = lastMessageReceivedRef;

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setSocketStatus("error");
    });

    socket.on("connect", () => {
      socket.emit("join", { chatInstanceId });
      setSocketStatus("connected");
      
      // ONLY fetch if we have absolutely no messages - never fetch on reconnect
      if (messages.length === 0) {
        console.log("[AISmarttalk Socket] Initial connection, fetching messages");
        fetchMessagesFromApi();
      }
    });

    socket.on("disconnect", () => {
      setSocketStatus("disconnected");
    });

    socket.on("chat-message", (data) => {
      if (data.chatInstanceId === chatInstanceId) {
        // Update timestamp BEFORE processing
        const now = Date.now();
        lastMessageReceivedRef.current = now;
        socketRef.current._lastMessageTime = now;
        
        // Skip duplicate messages
        if (isMessageDuplicate(data.message, messages)) {
          console.log("[AISmarttalk Socket] Skipping duplicate message:", data.message.id);
          return;
        }
        
        // Determine if message is from current user
        const isCurrentUser = 
          (user.id && user.id !== "anonymous" && data.message.user?.id === user.id) || 
          (user.email && data.message.user?.email === user.email);
        
        const isAnonymousUser = 
          user.id === "anonymous" && 
          (data.message.user?.id === "anonymous" || 
           data.message.user?.email === "anonymous@example.com");
        
        // Add message
        dispatch({
          type: ChatActionTypes.ADD_MESSAGE,
          payload: {
            message: {
              ...data.message,
              isSent: isCurrentUser || isAnonymousUser,
            },
            chatInstanceId,
            userId: user.id,
            userEmail: user.email,
          },
        });
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
          // Ensure we create a complete user object with token
          const finalUser: User = {
            ...data.user,
            token: data.token,
            id: data.user.id || `user-${data.user.email.split("@")[0]}`,
          };

          // Update user with the token
          setUser(finalUser);

          // Store directly to localStorage as backup in case setUser doesn't persist
          try {
            localStorage.setItem("user", JSON.stringify(finalUser));
          } catch (err) {
            console.error(
              "[AI Smarttalk] Failed to store user in localStorage:",
              err
            );
          }

          // Close the current socket
          socket.disconnect();
        } else {
          console.error(
            "[AI Smarttalk] Invalid user data from otp-login, missing token or user data"
          );
          // If we don't have both user and token, keep user as anonymous
          setUser({ ...initialUser });
          localStorage.removeItem("user");
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

    return () => {
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [chatInstanceId, chatModelId, finalWsUrl, user, finalApiUrl]);

  return socketRef;
};
