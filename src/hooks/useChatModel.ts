import { useState, useEffect } from "react";
import { ChatModel } from "../types/chatModel";

/**
 * A hook to fetch and manage chat model information
 * @param chatModelId - The ID of the chat model to fetch
 * @param apiToken - API token for authentication
 * @param aiSmartTalkApiUrl - Base URL for the AI SmartTalk API
 * @returns Object containing the fetched chat model data
 */

export const useChatModel = (
  chatModelId: string,
  apiToken: string,
  aiSmartTalkApiUrl: string
) => {
  const [chatModel, setChatModel] = useState<ChatModel | null>(null);

  useEffect(() => {
    const fetchChatModelInfo = async () => {
      try {
        const res = await fetch(
          `${aiSmartTalkApiUrl}/api/chat/getModel?id=${chatModelId}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              appToken: apiToken,
            },
          }
        );

        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const data = await res.json();
        setChatModel(data);
      } catch (error) {
        console.error("Error fetching chat model:", error);
        setChatModel(null);
      }
    };

    if (chatModelId && apiToken) {
      fetchChatModelInfo();
    }
  }, [chatModelId, apiToken, aiSmartTalkApiUrl]);

  return { chatModel };
};
