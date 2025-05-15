import {
  Dispatch,
  SetStateAction,
  useEffect,
  useCallback,
  useRef,
  useMemo,
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

interface SocketLogger {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  info: (...args: any[]) => void;
  debug: (...args: any[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
}

const createSocketLogger = (enabled: boolean): SocketLogger => {
  const timestamp = () => new Date().toISOString().split("T")[1].split(".")[0];

  return {
    log: (...args: any[]) => {
      if (enabled) {
        console.log(`[WebSocket][${timestamp()}]`, ...args);
      }
    },
    error: (...args: any[]) => {
      if (enabled) {
        console.error(`[WebSocket][${timestamp()}]`, ...args);
      }
    },
    warn: (...args: any[]) => {
      if (enabled) {
        console.warn(`[WebSocket][${timestamp()}]`, ...args);
      }
    },
    info: (...args: any[]) => {
      if (enabled) {
        console.info(`[WebSocket][${timestamp()}]`, ...args);
      }
    },
    debug: (...args: any[]) => {
      if (enabled) {
        console.debug(`[WebSocket][${timestamp()}]`, ...args);
      }
    },
    group: (label: string) => {
      if (enabled) {
        console.group(`[WebSocket][${timestamp()}] ${label}`);
      }
    },
    groupEnd: () => {
      if (enabled) {
        console.groupEnd();
      }
    },
  };
};

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
  debouncedTypingUsersUpdate: (data: TypingUser) => void,
  canvasHistory: ReturnType<typeof useCanvasHistory>,
  messages: FrontChatMessage[],
  debug: boolean = false
): any => {
  const socketRef = useRef<any>(null);
  const currentInstanceRef = useRef<string>(chatInstanceId);
  const lastMessageReceivedRef = useRef<number>(0);
  const reconnectCountRef = useRef<number>(0);
  const socketEventCountsRef = useRef<Record<string, number>>({});
  const connectAttemptsRef = useRef<number>(0);

  const logger = useMemo(() => createSocketLogger(debug), [debug]);

  const stableTypingUpdate = useCallback(debouncedTypingUsersUpdate, []);

  const trackEvent = useCallback(
    (eventName: string) => {
      if (!debug) return;

      socketEventCountsRef.current[eventName] =
        (socketEventCountsRef.current[eventName] || 0) + 1;
      logger.debug(
        `Event "${eventName}" triggered (count: ${socketEventCountsRef.current[eventName]})`
      );
    },
    [debug, logger]
  );

  useEffect(() => {
    if (currentInstanceRef.current !== chatInstanceId) {
      logger.group("Chat Instance Changed");
      logger.log(
        `Previous: ${currentInstanceRef.current}, New: ${chatInstanceId}`
      );

      if (socketRef.current) {
        logger.log(
          "Cleaning up previous socket connection due to instance change"
        );

        const lastMsgTime = socketRef.current._lastMessageTime || Date.now();

        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;

        lastMessageReceivedRef.current = lastMsgTime;
      }

      currentInstanceRef.current = chatInstanceId;
      reconnectCountRef.current = 0;
      logger.groupEnd();
    }
  }, [chatInstanceId, logger]);

  useEffect(() => {
    if (!chatInstanceId || !chatModelId || !finalApiUrl) {
      logger.log("Missing required params, not connecting socket", {
        chatInstanceId: !!chatInstanceId,
        chatModelId: !!chatModelId,
        apiUrl: !!finalApiUrl,
      });

      if (socketRef.current) {
        logger.log("Cleaning up socket due to missing parameters");
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return () => {
        if (socketRef.current) {
          socketRef.current.removeAllListeners();
          socketRef.current.disconnect();
          socketRef.current = null;
        }
      };
    }

    if (socketRef.current) {
      logger.log(
        "Cleaning up previous socket connection before new connection"
      );
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    lastMessageReceivedRef.current = Date.now();
    connectAttemptsRef.current++;

    logger.group("Socket Connection");
    logger.log(
      `Attempt #${connectAttemptsRef.current} - Connecting to: ${finalWsUrl}`
    );
    logger.log("Connection parameters:", {
      chatInstanceId,
      userId: user.id || initialUser.id,
      reconnect: false,
      messages: messages.length,
    });

    const socket = socketIOClient(finalWsUrl, {
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 20000,
    });

    socket.on('connect', () => {
      socket.emit('join', { chatInstanceId });
    });

    socketRef.current = socket;
    socketRef.current._lastMessageTime = lastMessageReceivedRef.current;
    socketRef.current.lastMessageReceivedRef = lastMessageReceivedRef;
    socketRef.current._debug = debug;
    socketRef.current._connectTime = Date.now();

    socket.on("connect_error", (err) => {
      trackEvent("connect_error");
      logger.error("Socket connection error:", err.message || err);
      logger.log("Connection details:", {
        url: finalWsUrl,
        chatInstanceId,
        attempt: connectAttemptsRef.current,
        connectionAge: Date.now() - (socketRef.current?._connectTime || 0),
      });
      setSocketStatus("error");
    });

    socket.on("connect", () => {
      trackEvent("connect");
      const connectionTime =
        Date.now() - (socketRef.current?._connectTime || Date.now());
      logger.log(`Socket connected successfully in ${connectionTime}ms`);

      socket.emit("join", { chatInstanceId });
      setSocketStatus("connected");
    });

    socket.on("disconnect", (reason) => {
      trackEvent("disconnect");
      reconnectCountRef.current++;

      logger.group("Socket Disconnected");
      logger.log(`Reason: ${reason}`);
      logger.log(`Disconnect #${reconnectCountRef.current}`);
      logger.log(
        "Socket lifetime:",
        `${(Date.now() - socketRef.current?._connectTime) / 1000}s`
      );
      logger.log("Connection info:", {
        messagesReceived: socketEventCountsRef.current["chat-message"] || 0,
        lastMessageTime: lastMessageReceivedRef.current
          ? new Date(lastMessageReceivedRef.current).toISOString()
          : "none",
        currentMessages: messages.length,
      });
      logger.groupEnd();

      setSocketStatus("disconnected");
    });

    socket.io.on("reconnect_attempt", (attemptNumber) => {
      logger.log(`Reconnection attempt #${attemptNumber}`);
      setSocketStatus("reconnecting");
    });

    socket.io.on("reconnect", () => {
      logger.log("Socket reconnected successfully");
      socket.emit("join", { chatInstanceId });
      setSocketStatus("connected");
    });

    socket.io.on("reconnect_failed", () => {
      logger.error("Socket reconnection failed after max attempts");
      setSocketStatus("error");
    });

    socket.on("chat-message", (data) => {
      trackEvent("chat-message");

      if (data.chatInstanceId === chatInstanceId) {
        logger.group("Message Received");
        logger.log("Message:", {
          id: data.message?.id,
          text: data.message?.text?.substring(0, 30) + "...",
          fromUser: data.message?.user?.id === user.id,
        });

        const now = Date.now();
        lastMessageReceivedRef.current = now;
        socketRef.current._lastMessageTime = now;

        // Check if this is a normal message or a temp message
        const isCurrentUser =
          (user.id &&
            user.id !== "anonymous" &&
            data.message.user?.id === user.id) ||
          (user.email && data.message.user?.email === user.email);

        const isAnonymousUser =
          user.id === "anonymous" &&
          (data.message.user?.id === "anonymous" ||
            data.message.user?.email === "anonymous@example.com");

        logger.log(
          "Processing message with isSent:",
          isCurrentUser || isAnonymousUser
        );

        // Let the reducer handle the message combining logic
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

        logger.log("Message processing complete");
        logger.groupEnd();
      } else {
        logger.log("Ignoring message for different chat instance", {
          messageFor: data.chatInstanceId,
          current: chatInstanceId,
        });
      }
    });

    socket.on("user-typing", (data: TypingUser) => {
      trackEvent("user-typing");
      stableTypingUpdate(data);
    });

    socket.on("update-suggestions", (data) => {
      trackEvent("update-suggestions");
      if (data.chatInstanceId === chatInstanceId) {
        logger.log("Received suggestions update", {
          count: data.suggestions?.length || 0,
        });
        saveSuggestions(chatInstanceId, data.suggestions);
        dispatch({
          type: ChatActionTypes.UPDATE_SUGGESTIONS,
          payload: { suggestions: data.suggestions },
        });
      }
    });

    socket.on("conversation-starters", (data) => {
      trackEvent("conversation-starters");
      if (
        data.chatInstanceId === chatInstanceId &&
        data.conversationStarters?.length
      ) {
        logger.log("Received conversation starters", {
          count: data.conversationStarters.length,
        });
        setConversationStarters(data.conversationStarters);
        saveConversationStarters(chatModelId, data.conversationStarters);
      }
    });

    socket.on(
      "otp-login",
      (data: { chatInstanceId: string; user: User; token: string }) => {
        trackEvent("otp-login");
        logger.group("OTP Login");

        if (data.user && data.token) {
          const finalUser: User = {
            ...data.user,
            token: data.token,
            id: data.user.id || `user-${data.user.email.split("@")[0]}`,
          };

          logger.log("Received user token", {
            email: finalUser.email,
            id: finalUser.id,
          });

          setUser(finalUser);

          try {
            localStorage.setItem("user", JSON.stringify(finalUser));
            logger.log("User saved to localStorage");
          } catch (err) {
            logger.error("Failed to store user in localStorage:", err);
          }

          logger.log(
            "Disconnecting socket to reconnect with new user credentials"
          );
          socket.disconnect();
        } else {
          logger.error(
            "Invalid user data from otp-login, missing token or user data"
          );
          setUser({ ...initialUser });
          localStorage.removeItem("user");
        }

        logger.groupEnd();
      }
    );

    socket.on("tool-run-start", (data: Tool) => {
      trackEvent("tool-run-start");
      logger.log("Tool started:", data.name);
      setActiveTool(data);
    });

    socket.on("canvas:update", (canvas: Canvas) => {
      trackEvent("canvas:update");
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
        trackEvent("canvas:line-update");
        canvasHistory.updateLineRange(start, end, lines);
      }
    );

    socket.onAny((event) => {
      if (debug) {
        logger.debug(`Socket event: ${event}`);
      }
    });

    logger.log("Socket setup complete, waiting for connection events");
    logger.groupEnd();

    return () => {
      if (socket) {
        logger.log("Cleaning up socket on unmount/effect cleanup");
        logger.log(
          "Socket lifetime:",
          `${(Date.now() - socketRef.current?._connectTime) / 1000}s`
        );
        logger.log("Events received:", socketEventCountsRef.current);

        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [chatInstanceId, chatModelId, finalWsUrl]);

  return socketRef;
};
