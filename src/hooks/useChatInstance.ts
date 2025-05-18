import { useEffect, useState, useCallback, useRef } from "react";
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

  // Try to load instance from localStorage immediately
  const getInitialInstanceId = () => {
    try {
      const savedInstance = localStorage.getItem(storageKey);
      return savedInstance || '';
    } catch (err) {
      console.error('Error reading from localStorage:', err);
      return '';
    }
  };

  const [chatInstanceId, setChatInstanceId] = useState<string>(getInitialInstanceId);
  const [error, setError] = useState<Error | null>(null);
  const isChangingRef = useRef(false);
  const hasInitializedRef = useRef(false);

  const cleanup = useCallback(() => {
    setChatInstanceId('');
    try {
      localStorage.removeItem(storageKey);
    } catch (err) {
      console.error('Error cleaning up localStorage:', err);
    }
    // Give time for consumers to cleanup their sockets
    return new Promise(resolve => setTimeout(resolve, 100));
  }, [storageKey]);

  const initializeChatInstance = async () => {   
    try {
      console.log('initializeChatInstance with isChanging', isChangingRef.current);
      if (isChangingRef.current) return null;
  
      isChangingRef.current = true;
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
        isChangingRef.current = false;
        return null;
      }

      const data = await response.json();
      const instanceId = data.chatInstanceId;
      
      if (!instanceId) {
        isChangingRef.current = false;
        return null;
      }

      try {
        localStorage.setItem(storageKey, instanceId);
      } catch (err) {}

      setChatInstanceId(instanceId);
      isChangingRef.current = false;
      setError(null);
      return instanceId;
    } catch (err) {
      isChangingRef.current = false;
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initializeOrSwitchInstance = async () => {
      console.log('initializeOrSwitchInstance');
      console.log(isAdmin, chatModelId, storageKey, isChangingRef.current, chatInstanceId, hasInitializedRef.current)
      // Skip if already initialized or currently changing
      if (isChangingRef.current || hasInitializedRef.current) return;

      console.log('initializeOrSwitchInstance 2');

      let savedInstance = null;
      try {
        savedInstance = localStorage.getItem(storageKey);
      } catch (err) {
        console.error('Error reading from localStorage:', err);
      }
      
      if (savedInstance && savedInstance.length > 0) {
        if (isMounted) {
          setChatInstanceId(savedInstance);
          isChangingRef.current = false;
          hasInitializedRef.current = true;
        }
      } else if (!chatInstanceId && isMounted) {
        try {
          const newInstanceId = await initializeChatInstance();
          if (isMounted) {
            setChatInstanceId(newInstanceId);
            hasInitializedRef.current = true;
          }
        } catch (error) {
          console.error('Failed to initialize instance:', error);
          if (isMounted) {
            setError(error instanceof Error ? error : new Error('Failed to initialize instance'));
          }
        }
      } else {
        // Mark as initialized if we already have an instance ID
        hasInitializedRef.current = true;
      }
    };

    initializeOrSwitchInstance();

    return () => {
      isMounted = false;
    };
  }, [isAdmin, chatModelId, storageKey, isChangingRef.current, chatInstanceId]); 

  return {
    chatInstanceId,
    getNewInstance: initializeChatInstance,
    setChatInstanceId,
    error,
    isChanging: isChangingRef.current,
    cleanup
  };
};

export default useChatInstance;
