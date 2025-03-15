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
  const fetchInProgressRef = useRef<boolean>(false);
  const userIdRef = useRef<string>(user?.id || "anonymous");

  const stableFetchMessages = useCallback(() => {
    // Prevent concurrent fetches - only one fetch can run at a time
    if (fetchInProgressRef.current) {
      return;
    }

    // Set fetch in progress flag
    fetchInProgressRef.current = true;

    // Call the actual fetch function
    fetchMessagesFromApi();

    // Reset the flag after a short delay to allow for race condition recovery
    setTimeout(() => {
      fetchInProgressRef.current = false;
    }, 500);
  }, [fetchMessagesFromApi]);

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
      // Reset message received flag on instance change
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

    // Update the userIdRef with current user ID
    userIdRef.current = user.id || initialUser.id || "anonymous";

    // CRITICAL FIX: For anonymous users, ensure all their messages are marked as sent
    if (user.id === "anonymous") {
      // Find any messages from this user that aren't marked as sent
      const messagesToFix = messages.filter(
        (msg) =>
          (msg.user?.id === "anonymous" ||
            msg.user?.email === "anonymous@example.com") &&
          !msg.isSent
      );

      if (messagesToFix.length > 0) {
        // Update each message to ensure it's marked as sent
        messagesToFix.forEach((msg) => {
          dispatch({
            type: ChatActionTypes.UPDATE_MESSAGE,
            payload: {
              message: {
                ...msg,
                isSent: true,
              },
              chatInstanceId,
              userId: user.id,
              userEmail: user.email,
            },
          });
        });
      }
    }

    const socket = socketIOClient(finalWsUrl, {
      query: {
        chatInstanceId,
        userId: user.id || initialUser.id,
        userEmail: user.email || initialUser.email,
        userName: user.name || initialUser.name,
      },
      forceNew: true,
      reconnection: false, // Disable auto-reconnection
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
      socket.emit("join", { chatInstanceId });
      setSocketStatus("connected");

      // Check if we've received a message very recently (within 2 seconds)
      // If so, we can skip the initial fetch to avoid flickering
      const timeSinceLastMessage = Date.now() - lastMessageReceivedRef.current;
      if (timeSinceLastMessage > 2000) {
        stableFetchMessages();
      }
    });

    socket.on("disconnect", (reason) => {
      setSocketStatus("disconnected");
    });

    socket.on("chat-message", (data) => {
      if (data.chatInstanceId === chatInstanceId) {
        // For anonymous users, IMMEDIATELY check if this is a duplicate by text
        // and completely skip processing if it is
        if (user.id === "anonymous") {
          const exactTextMatch = messages.some(
            (msg) => msg.text.trim() === data.message.text.trim()
          );

          if (exactTextMatch) {
            return; // Skip all processing for this message
          }
        }

        // Check if this message already exists in the state by comparing ID or content + timing
        const messageAlreadyExists = messages.some(
          (existingMsg) =>
            // Check by ID
            existingMsg.id === data.message.id ||
            // Or check by content + timing for ANY message (not just those with matching email)
            (existingMsg.text === data.message.text &&
              Math.abs(
                new Date(existingMsg.created_at).getTime() -
                  new Date(data.message.created_at || Date.now()).getTime()
              ) < 5000)
        );

        // SIMPLIFICATION: Pour les messages anonymes - si l'email correspond à anonymous@example.com,
        // OU si le message était envoyé par l'utilisateur actuel (email correspond), c'est le message de l'utilisateur
        const isAnonymousMessage =
          data.message.user?.email === initialUser.email ||
          data.message.user?.email === user.email;

        // On garde la vérification par délai pour tous les cas
        const isDuplicateByTimestamp = messages.some(
          (existingMsg) =>
            existingMsg.text === data.message.text &&
            existingMsg.isSent === true &&
            Math.abs(
              new Date(existingMsg.created_at).getTime() -
                new Date(data.message.created_at || Date.now()).getTime()
            ) < 5000 // 5 secondes de différence max
        );

        // Pour les utilisateurs non-anonymes, utiliser la méthode standard
        const isOwnMessage =
          isAnonymousMessage ||
          (user.id !== "anonymous" &&
            (data.message.user?.id === user.id ||
              (user.email && data.message.user?.email === user.email))) ||
          isDuplicateByTimestamp; // On ajoute la vérification par délai

        if (!isOwnMessage) {        
          lastMessageReceivedRef.current = Date.now();

          // Check if this is an AI message (empty email) or a user message
          const isAIMessage =
            !data.message.user?.email || data.message.user.email === "";

          // For anonymous users, only allow AI messages to be added with isSent=false
          if (user.id === "anonymous" && !isAIMessage) {
            return; // Skip adding this message completely
          }

          // Special case: if we're an anonymous user, we need to check if this message
          // might actually be ours but wasn't detected by the normal checks
          if (user.id === "anonymous") {
            // For anonymous users, ANY message with the same text is considered our own
            // This is a more aggressive check specifically for anonymous users
            const sameTextMessage = messages.some(
              (msg) => msg.text.trim() === data.message.text.trim()
            );

            if (sameTextMessage) {
              // Find the message with the same text and ensure it's marked as sent
              const existingMsgIndex = messages.findIndex(
                (msg) => msg.text.trim() === data.message.text.trim()
              );

              if (existingMsgIndex !== -1) {
                const existingMsg = messages[existingMsgIndex];                
                if (!existingMsg.isSent) {
                  dispatch({
                    type: ChatActionTypes.UPDATE_MESSAGE,
                    payload: {
                      message: {
                        ...existingMsg,
                        isSent: true,
                      },
                      chatInstanceId,
                      userId: user.id,
                      userEmail: user.email,
                    },
                  });
                }
              }

              return; // Skip adding this message
            }

            // For anonymous users, check if there's a message with similar text and timing
            // that was already marked as sent by us
            const possibleOwnMessage = messages.some(
              (msg) =>
                msg.text === data.message.text &&
                msg.isSent === true &&
                Math.abs(
                  new Date(msg.created_at).getTime() -
                    new Date(data.message.created_at || Date.now()).getTime()
                ) < 10000 // 10 seconds window for anonymous users
            );

            if (possibleOwnMessage) {
              return; // Skip adding this message as it's likely our own
            }

            dispatch({
              type: ChatActionTypes.ADD_MESSAGE,
              payload: {
                message: {
                  ...data.message,
                  isSent: true, // Force isSent=true for anonymous users
                },
                chatInstanceId,
                userId: user.id,
                userEmail: user.email,
              },
            });
            return; // Skip the normal dispatch below
          }

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
        } else {          
          const messageExists = messages.some(
            (msg) =>
              msg.text === data.message.text &&
              Math.abs(
                new Date(msg.created_at).getTime() -
                  new Date(data.message.created_at || Date.now()).getTime()
              ) < 5000
          );

          if (isAnonymousMessage && !messageExists) {            
            dispatch({
              type: ChatActionTypes.ADD_MESSAGE,
              payload: {
                message: {
                  ...data.message,
                  isSent: true, // Forcément envoyé car c'est le nôtre
                },
                chatInstanceId,
                userId: user.id,
                userEmail: user.email,
              },
            });
          }
          // Ensure existing messages from anonymous users stay marked as sent
          else if (isAnonymousMessage && user.id === "anonymous") {           
            // Find the existing message and update its isSent property if needed
            const existingMsgIndex = messages.findIndex(
              (msg) =>
                msg.text === data.message.text &&
                Math.abs(
                  new Date(msg.created_at).getTime() -
                    new Date(data.message.created_at || Date.now()).getTime()
                ) < 5000
            );

            if (existingMsgIndex !== -1) {
              const existingMsg = messages[existingMsgIndex];              
              if (!existingMsg.isSent) {                
                dispatch({
                  type: ChatActionTypes.UPDATE_MESSAGE,
                  payload: {
                    message: {
                      ...existingMsg,
                      isSent: true,
                    },
                    chatInstanceId,
                    userId: user.id,
                    userEmail: user.email,
                  },
                });
              }
            }
          }
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
          // Ensure we create a complete user object with token
          const finalUser: User = {
            ...data.user,
            token: data.token, // Make sure token is set here
            id: data.user.id || `user-${data.user.email.split("@")[0]}`, // Ensure ID is set
          };

          // Log the constructed user to help debug

          // Store the userID to detect changes
          userIdRef.current = finalUser.id || initialUser.id || "anonymous";

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

          // Need to reconnect the socket with the new user credentials

          // Close the current socket
          socket.disconnect();

          // We'll reconnect in the next useEffect cycle with the new user credentials
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

    socket.on("reconnect_attempt", () => {
      setSocketStatus("connecting");
    });

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
