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

  const [chatInstanceId, setChatInstanceId] = useState<string>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved || '';
  });
  const [error, setError] = useState<Error | null>(null);

  /**
   * Initializes the chat instance by either retrieving an existing instance from localStorage
   * or creating a new one if none exists
   */
  const initializeChatInstance = async (lang: string) => {
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
        body: JSON.stringify({ chatModelId, lang }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create chat instance: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const instanceId = isAdmin ? data.instanceId : data.chatInstanceId;

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
    // Skip initialization for admin mode unless chatInstanceId is empty
    if (isAdmin && chatInstanceId) return;
    
    const savedInstance = localStorage.getItem(storageKey);
    if (savedInstance && savedInstance.length > 0) {
      setChatInstanceId(savedInstance);
    } else if (!chatInstanceId) {
      initializeChatInstance(lang);
    }
  }, [chatModelId, lang]); // Only depend on chatModelId changes

  return {
    chatInstanceId,
    getNewInstance: initializeChatInstance,
    setChatInstanceId,
    error,
  };
};

export default useChatInstance;
