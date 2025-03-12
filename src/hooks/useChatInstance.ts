import { useEffect, useState, useCallback } from "react";
import { defaultApiUrl } from "../types/config";

/**
 * Props for the useChatInstance hook
 */
interface UseChatInstanceProps {
  /** ID of the chat model to use */
  chatModelId: string;
  /** Language code for the chat instance */
  lang: string;
  /** Optional configuration object */
  config?: {
    /** Base API URL */
    apiUrl?: string;
    /** API authentication token */
    apiToken?: string;
  };
  /** Optional user object */
  user?: {
    /** User's authentication token */
    token?: string;
    /** User's ID */
    id?: string;
    /** User's email */
    email?: string;
    /** User's name */
    name?: string;
  };
  isAdmin?: boolean;
}

/**
 * Hook to manage a chat instance lifecycle
 *
 * Handles creation, retrieval and reset of chat instances. Maintains the chat instance ID
 * in both state and localStorage for persistence across page reloads.
 *
 * @param props - Configuration options for the chat instance
 * @returns Object containing the chat instance ID and methods to manage it
 */
export const useChatInstance = ({
  chatModelId,
  lang,
  config,
  user,
  isAdmin = false,
}: UseChatInstanceProps) => {
  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalApiToken = config?.apiToken || "";
  const storageKey = `chatInstanceId[${chatModelId}${isAdmin ? '-smartadmin': '-standard'}]`;

  const [chatInstanceId, setChatInstanceId] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);
  const [isChanging, setIsChanging] = useState<boolean>(false);

  const cleanup = useCallback(() => {
    setChatInstanceId('');
    try {
      localStorage.removeItem(storageKey);
    } catch (err) {
      console.error('Error cleaning up localStorage:', err);
    }
    setIsChanging(true);
    // Give time for consumers to cleanup their sockets
    return new Promise(resolve => setTimeout(resolve, 100));
  }, [storageKey]);

  const initializeChatInstance = async () => {
    try {
      await cleanup();
      
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        appToken: finalApiToken,
      };

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers["Authorization"] = `Bearer ${user.token}`;
      }

      const url = isAdmin ? 
        `${finalApiUrl}/api/admin/chatModel/${chatModelId}/smartadmin/instance` : 
        `${finalApiUrl}/api/chat/createInstance`;    

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ 
          chatModelId, 
          lang,
          userEmail: user?.email || 'anonymous@example.com',
          userName: user?.name || 'Anonymous'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create chat instance: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const instanceId = data.chatInstanceId;

      try {
        localStorage.setItem(storageKey, instanceId);
      } catch (err) {
        console.error('Error saving to localStorage:', err);
      }

      setChatInstanceId(instanceId);
      setIsChanging(false);
      setError(null);
      return instanceId;
    } catch (err) {
      console.error("Error in initializeChatInstance:", err);
      setError(err instanceof Error ? err : new Error("Failed to create chat instance"));
      setIsChanging(false);
      throw err;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initializeOrSwitchInstance = async () => {
      if (isChanging) return;

      let savedInstance = null;
      try {
        savedInstance = localStorage.getItem(storageKey);
      } catch (err) {
        console.error('Error reading from localStorage:', err);
      }
      
      if (savedInstance && savedInstance.length > 0) {
        if (isMounted) {
          setChatInstanceId(savedInstance);
          setIsChanging(false);
        }
      } else if (!chatInstanceId && isMounted) {
        try {
          const newInstanceId = await initializeChatInstance();
          if (isMounted) {
            setChatInstanceId(newInstanceId);
          }
        } catch (error) {
          console.error('Failed to initialize instance:', error);
          if (isMounted) {
            setError(error instanceof Error ? error : new Error('Failed to initialize instance'));
          }
        }
      }
    };

    initializeOrSwitchInstance();

    return () => {
      isMounted = false;
    };
  }, [isAdmin, chatModelId, storageKey, isChanging, chatInstanceId]); 

  return {
    chatInstanceId,
    getNewInstance: initializeChatInstance,
    setChatInstanceId,
    error,
    isChanging,
    cleanup
  };
};

export default useChatInstance;
