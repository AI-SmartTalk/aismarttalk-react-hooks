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

  const [chatInstanceId, setChatInstanceId] = useState<string>('');
  const [error, setError] = useState<Error | null>(null);

  /**
   * Initializes the chat instance by either retrieving an existing instance from localStorage
   * or creating a new one if none exists
   */
  const initializeChatInstance = async () => {
    try {
      const savedInstance = localStorage.getItem(
        `chatInstanceId[${chatModelId}]`
      );
      if (savedInstance && savedInstance.length > 0) {
        setChatInstanceId(savedInstance);
      } else {
        await getNewInstance(lang);
      }
    } catch (err) {
      console.error("Error initializing chat instance:", {
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined,
      });
      setError(err instanceof Error ? err : new Error("Unknown error"));
      await getNewInstance(lang);
    }
  };

  /**
   * Creates a new chat instance with the specified language
   *
   * @param newLang - Language code for the new chat instance
   * @throws Error if the API request fails
   */
  const getNewInstance = async (newLang: string): Promise<string> => {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        appToken: finalApiToken,
      };

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers["Authorization"] = `Bearer ${user.token}`;
      }

      const url =  isAdmin ?  `${finalApiUrl}/api/admin/chatModel/${chatModelId}/smartadmin/instance` : `${finalApiUrl}/api/chat/createInstance`;    
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ chatModelId, lang: newLang }),
      });

      if (!response.status || response.status < 200 || response.status >= 300) {
        const errorText = await response.text();
        throw new Error(
          `Failed to create chat instance: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();

      const instanceId = isAdmin ? data.instanceId : data.chatInstanceId;

      try {
        localStorage.setItem(
          `chatInstanceId[${chatModelId}]`,
          instanceId
        );
      } catch (storageError) {
        console.error("Error saving to localStorage:", {
          error:
            storageError instanceof Error
              ? storageError.message
              : "Unknown storage error",
        });
      }

      setChatInstanceId(instanceId);
      setError(null);
      return instanceId;
    } catch (err) {
      const errorDetails = {
        message: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined,
        type: err instanceof Error ? err.constructor.name : typeof err,
      };
      console.error("Error in getNewInstance:", errorDetails);
      setError(
        err instanceof Error ? err : new Error("Failed to create chat instance")
      );
      throw err;
    }
  };
  

  useEffect(() => {
    if(isAdmin) return;
    initializeChatInstance();
  }, [chatModelId, lang, user, finalApiUrl, finalApiToken]);

  return {
    chatInstanceId,
    getNewInstance,
    setChatInstanceId,
    error,
  };
};

export default useChatInstance;
