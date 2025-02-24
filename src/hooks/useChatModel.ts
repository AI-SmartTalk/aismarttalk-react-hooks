import { useState, useEffect } from "react";
import { ChatModel } from "../types/chatModel";

/**
 * A hook to fetch and manage chat model information
 * @param chatModelId - The ID of the chat model to fetch
 * @param apiToken - API token for authentication
 * @param aiSmartTalkApiUrl - Base URL for the AI SmartTalk API
 * @returns Object containing the fetched chat model data
 */

interface UseChatModelProps {
    /** ID of the chat model to use */
    chatModelId: string;      
    /** Optional configuration object */
    config?: {
      /** Base API URL */
      apiUrl?: string;     
      /** API authentication token */
      apiToken?: string;
    };   
  }

  export const useChatModel = ({
    chatModelId,
    config,
  }: UseChatModelProps) => {
    const {
      apiUrl = 'https://aismarttalk.tech',
      apiToken = '',
    } = config || {};
  const [chatModel, setChatModel] = useState<ChatModel | null>(null);

  const fetchChatModel = async () => {
    try {
      const { apiUrl = config?.apiUrl || 'https://aismarttalk.tech', apiToken } = config || {};
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (apiToken) {
        headers['appToken'] = apiToken;
      }

      const response = await fetch(`${apiUrl}/api/chat/getModel?id=${chatModelId}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch chat model: ${response.statusText}`);
      }

      const data = await response.json();
      setChatModel(data);
    } catch (err) {
      console.error('Error fetching chat model:', err);
    }
  };

  useEffect(() => {
    fetchChatModel();
  }, [chatModelId]);

  return { chatModel, setChatModel };
};
