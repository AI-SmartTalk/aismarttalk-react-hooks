import { useEffect, useState } from "react";
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
  
  // Include user ID in storage key to separate instances per user
  const userId = user?.id || `user-${user?.email?.split('@')[0] || 'anonymous'}`;
  const storageKey = `chatInstanceId[${chatModelId}][${userId}]${isAdmin ? '-smartadmin': '-standard'}`;

  // Initialize state with empty string, we'll handle storage reading in useEffect
  const [chatInstanceId, setChatInstanceId] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);

  /**
   * Initializes the chat instance by either retrieving an existing instance from localStorage
   * or creating a new one if none exists
   */
  const initializeChatInstance = async () => {
    try {
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
          userId,
          userEmail: user?.email || 'anonymous@example.com',
          userName: user?.name || 'Anonymous'
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create chat instance: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      // Both APIs return chatInstanceId in the same format
      const instanceId = data.chatInstanceId;

      localStorage.setItem(storageKey, instanceId);
      setChatInstanceId(instanceId);
      setError(null);
      return instanceId;
    } catch (err) {
      console.error("Error in initializeChatInstance:", err);
      setError(err instanceof Error ? err : new Error("Failed to create chat instance"));
      throw err;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initializeOrSwitchInstance = async () => {
      const savedInstance = localStorage.getItem(storageKey);
      
      if (savedInstance && savedInstance.length > 0) {
        if (isMounted) {
          setChatInstanceId(savedInstance);
        }
      } else if (!chatInstanceId && isMounted) {
        try {
          await initializeChatInstance();
        } catch (error) {
          console.error('Failed to initialize instance:', error);
        }
      }
    };

    initializeOrSwitchInstance();

    return () => {
      isMounted = false;
    };
  }, [isAdmin, chatModelId, userId]); 

  return {
    chatInstanceId,
    getNewInstance: initializeChatInstance,
    setChatInstanceId,
    error,
  };
};

export default useChatInstance;
