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
import useCanvasHistory from "../canva/useCanvasHistory";
import { CanvasLiveUpdate } from "../fileUpload/useFileUpload";

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
  debug: boolean = true
): any => {
  const socketRef = useRef<any>(null);
  const currentInstanceRef = useRef<string>(chatInstanceId);
  const lastMessageReceivedRef = useRef<number>(0);
  const reconnectCountRef = useRef<number>(0);
  const socketEventCountsRef = useRef<Record<string, number>>({});
  const connectAttemptsRef = useRef<number>(0);
  
  // Store canvasHistory in a ref to avoid triggering reconnections
  const canvasHistoryRef = useRef(canvasHistory);
  
  // Update the ref whenever canvasHistory changes, but don't trigger reconnection
  useEffect(() => {
    canvasHistoryRef.current = canvasHistory;
  }, [canvasHistory]);

  debug = true;

  const stableTypingUpdate = useCallback(debouncedTypingUsersUpdate, []);

  const trackEvent = useCallback(
    (eventName: string) => {
      if (!debug) return;

      socketEventCountsRef.current[eventName] =
        (socketEventCountsRef.current[eventName] || 0) + 1;
      console.log(
        `🔔 [WebSocket] Event "${eventName}" triggered (count: ${socketEventCountsRef.current[eventName]})`
      );
    },
    [debug]
  );

  useEffect(() => {
    if (currentInstanceRef.current !== chatInstanceId) {
      if (debug) {
        console.log("🔄 [WebSocket] Chat Instance Changed");
        console.log(`   Previous: ${currentInstanceRef.current}`);
        console.log(`   New: ${chatInstanceId}`);
      }

      if (socketRef.current) {
        if (debug) {
          console.log("🧹 [WebSocket] Cleaning up previous socket connection due to instance change");
        }

        const lastMsgTime = socketRef.current._lastMessageTime || Date.now();

        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;

        lastMessageReceivedRef.current = lastMsgTime;
      }

      currentInstanceRef.current = chatInstanceId;
      reconnectCountRef.current = 0;
    }
  }, [chatInstanceId, debug]);

  useEffect(() => {
    if (!chatInstanceId || !chatModelId || !finalApiUrl) {
      if (debug) {
        console.log("⚠️ [WebSocket] Missing required params, not connecting socket");
        console.log("   chatInstanceId:", !!chatInstanceId);
        console.log("   chatModelId:", !!chatModelId);
        console.log("   apiUrl:", !!finalApiUrl);
      }

      if (socketRef.current) {
        if (debug) {
          console.log("🧹 [WebSocket] Cleaning up socket due to missing parameters");
        }
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
      if (debug) {
        console.log("🧹 [WebSocket] Cleaning up previous socket connection before new connection");
      }
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    lastMessageReceivedRef.current = Date.now();
    connectAttemptsRef.current++;

    if (debug) {
      console.log("\n🔌 [WebSocket] Socket Connection");
      console.log(`   Attempt #${connectAttemptsRef.current}`);
      console.log(`   URL: ${finalWsUrl}`);
      console.log("   Connection parameters:", {
        chatInstanceId,
        userId: user.id || initialUser.id,
        reconnect: false,
        messages: messages.length,
      });
    }

    const socket = socketIOClient(finalWsUrl, {
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 45000,                    // Increased from 20s to 45s to match server
      transports: ['websocket', 'polling'], // Explicitly prefer websocket first
      upgrade: true,                     // Allow transport upgrade
      rememberUpgrade: true,             // Remember successful upgrade
      reconnectionDelayMax: 5000,        // Max delay between reconnection attempts
      randomizationFactor: 0.5,          // Randomization factor for reconnection delay
    });

    socketRef.current = socket;
    socketRef.current._lastMessageTime = lastMessageReceivedRef.current;
    socketRef.current.lastMessageReceivedRef = lastMessageReceivedRef;
    socketRef.current._debug = debug;
    socketRef.current._connectTime = Date.now();

    socket.on("connect_error", (err) => {
      trackEvent("connect_error");
      if (debug) {
        console.error("❌ [WebSocket] Socket connection error:", err.message || err);
        console.log("   Connection details:", {
          url: finalWsUrl,
          chatInstanceId,
          attempt: connectAttemptsRef.current,
          connectionAge: Date.now() - (socketRef.current?._connectTime || 0),
        });
      }
      setSocketStatus("error");
    });

    socket.on("connect", () => {
      trackEvent("connect");
      const connectionTime =
        Date.now() - (socketRef.current?._connectTime || Date.now());
      if (debug) {
        console.log(`✅ [WebSocket] Socket connected successfully in ${connectionTime}ms`);
      }

      socket.emit("join", { chatInstanceId, chatModelId });
      setSocketStatus("connected");
    });

    // Listen for server confirmation that join was successful
    socket.on("joined", (data) => {
      trackEvent("joined");
      if (debug) {
        console.log("🎉 [WebSocket] Successfully Joined Channels");
        console.log("   Confirmation received from server:", {
          chatInstanceId: data.chatInstanceId,
          chatModelId: data.chatModelId,
          socketId: data.socketId,
          timestamp: data.timestamp
        });
        console.log("   ✓ User is now connected and ready to receive messages");
      }
    });

    socket.on("disconnect", (reason) => {
      trackEvent("disconnect");
      reconnectCountRef.current++;

      if (debug) {
        console.log("\n🔌❌ [WebSocket] Socket Disconnected");
        console.log(`   Reason: ${reason}`);
        console.log(`   Disconnect #${reconnectCountRef.current}`);
        console.log(
          `   Socket lifetime: ${(Date.now() - socketRef.current?._connectTime) / 1000}s`
        );
        console.log("   Connection info:", {
          messagesReceived: socketEventCountsRef.current["chat-message"] || 0,
          lastMessageTime: lastMessageReceivedRef.current
            ? new Date(lastMessageReceivedRef.current).toISOString()
            : "none",
          currentMessages: messages.length,
        });
      }

      setSocketStatus("disconnected");
    });

    socket.io.on("reconnect_attempt", (attemptNumber) => {
      if (debug) {
        console.log(`🔄 [WebSocket] Reconnection attempt #${attemptNumber}`);
      }
      setSocketStatus("reconnecting");
    });

    socket.io.on("reconnect", () => {
      if (debug) {
        console.log("✅ [WebSocket] Socket reconnected successfully, rejoining channels");
      }
      socket.emit("join", { chatInstanceId, chatModelId });
      setSocketStatus("connected");
    });

    socket.io.on("reconnect_failed", () => {
      if (debug) {
        console.error("❌ [WebSocket] Socket reconnection failed after max attempts");
      }
      setSocketStatus("error");
    });

    socket.on("chat-message", (data) => {
      trackEvent("chat-message");

      if (data.chatInstanceId === chatInstanceId) {
        if (debug) {
          console.log("\n💬 [WebSocket] Message Received");
          console.log("   Message:", {
            id: data.message?.id,
            text: data.message?.text?.substring(0, 30) + "...",
            fromUser: data.message?.user?.id === user.id,
          });
        }

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

        if (debug) {
          console.log(
            "   Processing message with isSent:",
            isCurrentUser || isAnonymousUser
          );
        }

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

        if (debug) {
          console.log("   ✓ Message processing complete");
        }
      } else {
        if (debug) {
          console.log("⏭️ [WebSocket] Ignoring message for different chat instance", {
            messageFor: data.chatInstanceId,
            current: chatInstanceId,
          });
        }
      }
    });

    socket.on("user-typing", (data: TypingUser) => {
      trackEvent("user-typing");
      stableTypingUpdate(data);
    });

    socket.on("canvas-live-update", (data: CanvasLiveUpdate) => {
      trackEvent("canvas-live-update");
      if (debug) {
        console.log("\n🎨 [WebSocket] Canvas Live Update");
        console.log("   Canvas ID:", data.canvasId);
        console.log("   Updates count:", data.updates?.length || 0);
      }
      
      // Apply updates through useCanvasHistory
      try {
        canvasHistoryRef.current.applyCanvasLiveUpdate(data);
        if (debug) {
          console.log("   ✓ Canvas update applied successfully via useCanvasHistory");
        }
      } catch (error) {
        if (debug) {
          console.error("   ❌ Error applying canvas update via useCanvasHistory:", error);
        }
      }
      
      // Also dispatch to reducer for backward compatibility
      dispatch({
        type: ChatActionTypes.CANVAS_LIVE_UPDATE,
        payload: { canvasUpdate: data },
      });
    });

    socket.on("update-suggestions", (data) => {
      trackEvent("update-suggestions");
      if (data.chatInstanceId === chatInstanceId) {
        if (debug) {
          console.log("💡 [WebSocket] Received suggestions update", {
            count: data.suggestions?.length || 0,
          });
        }
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
        if (debug) {
          console.log("🚀 [WebSocket] Received conversation starters", {
            count: data.conversationStarters.length,
          });
        }
        setConversationStarters(data.conversationStarters);
        saveConversationStarters(chatModelId, data.conversationStarters);
      }
    });

    socket.on(
      "otp-login",
      (data: { chatInstanceId: string; user: User; token: string }) => {
        trackEvent("otp-login");
        if (debug) {
          console.log("\n🔐 [WebSocket] OTP Login");
        }

        if (data.user && data.token) {
          const finalUser: User = {
            ...data.user,
            token: data.token,
            id: data.user.id || `user-${data.user.email.split("@")[0]}`,
          };

          if (debug) {
            console.log("   Received user token", {
              email: finalUser.email,
              id: finalUser.id,
            });
          }

          setUser(finalUser);

          try {
            localStorage.setItem("user", JSON.stringify(finalUser));
            if (debug) {
              console.log("   ✓ User saved to localStorage");
            }
          } catch (err) {
            if (debug) {
              console.error("   ❌ Failed to store user in localStorage:", err);
            }
          }

          if (debug) {
            console.log("   🔌 Disconnecting socket to reconnect with new user credentials");
          }
          socket.disconnect();
        } else {
          if (debug) {
            console.error("   ❌ Invalid user data from otp-login, missing token or user data");
          }
          setUser({ ...initialUser });
          localStorage.removeItem("user");
        }
      }
    );

    socket.on("tool-run-start", (data: Tool) => {
      trackEvent("tool-run-start");
      if (debug) {
        console.log("🔧 [WebSocket] Tool started:", data.name);
      }
      setActiveTool(data);
    });

    // Legacy canvas events for backward compatibility
    socket.on("canvas:update", (canvas: any) => {
      trackEvent("canvas:update");
      if (debug) {
        console.log("🎨 [WebSocket] Legacy canvas:update event received");
      }
      try {
        // Convert legacy canvas format to new format if needed
        if (canvasHistoryRef.current.updateCanvas && typeof canvasHistoryRef.current.updateCanvas === 'function') {
          canvasHistoryRef.current.updateCanvas(canvas);
        }
      } catch (error) {
        if (debug) {
          console.error("   ❌ Error handling legacy canvas:update:", error);
        }
      }
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
        if (debug) {
          console.log("🎨 [WebSocket] Legacy canvas:line-update event received");
        }
        try {
          if (canvasHistoryRef.current.updateLineRange && typeof canvasHistoryRef.current.updateLineRange === 'function') {
            canvasHistoryRef.current.updateLineRange(start, end, lines);
          }
        } catch (error) {
          if (debug) {
            console.error("   ❌ Error handling legacy canvas:line-update:", error);
          }
        }
      }
    );

    socket.onAny((event) => {
      if (debug) {
        console.log(`🔔 [WebSocket] Socket event: ${event}`);
      }
    });

    if (debug) {
      console.log("✅ [WebSocket] Socket setup complete, waiting for connection events\n");
    }

    return () => {
      if (socket) {
        if (debug) {
          console.log("\n🧹 [WebSocket] Cleaning up socket on unmount/effect cleanup");
          console.log(
            `   Socket lifetime: ${(Date.now() - socketRef.current?._connectTime) / 1000}s`
          );
          console.log("   Events received:", socketEventCountsRef.current);
        }

        socket.removeAllListeners();
        socket.disconnect();
      }
      socketRef.current = null;
    };
  }, [chatInstanceId, chatModelId, finalWsUrl]);

  return socketRef;
};
