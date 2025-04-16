// src/utils/localStorageHelpers.ts

import { CTADTO } from "../types/chat";
import { FrontChatMessage } from "../types/chat";
import { identifyConversationOwner } from "./messageUtils";

/**
 * Save conversation starters to local storage.
 * @param chatModelId - The unique identifier for the chat model.
 * @param conversationStarters - An array of CTA data.
 */
export function saveConversationStarters(chatModelId: string, conversationStarters: CTADTO[]): void {
  localStorage.setItem(
    `chat-${chatModelId}-conversation-starters`,
    JSON.stringify(conversationStarters)
  );
}

/**
 * Load conversation starters from local storage.
 * @param chatModelId - The unique identifier for the chat model.
 * @returns An array of CTA data.
 */
export function loadConversationStarters(chatModelId: string): CTADTO[] {
  const data = localStorage.getItem(`chat-${chatModelId}-conversation-starters`);
  return data ? JSON.parse(data) : [];
}

/**
 * Save suggestions to local storage.
 * @param chatInstanceId - The unique identifier for the chat instance.
 * @param suggestions - An array of suggestion strings.
 */
export function saveSuggestions(chatInstanceId: string, suggestions: string[]): void {
  localStorage.setItem(
    `chat-${chatInstanceId}-suggestions`,
    JSON.stringify(suggestions)
  );
}

/**
 * Load suggestions from local storage.
 * @param chatInstanceId - The unique identifier for the chat instance.
 * @returns An array of suggestion strings.
 */
export function loadSuggestions(chatInstanceId: string): string[] {
  const data = localStorage.getItem(`chat-${chatInstanceId}-suggestions`);
  return data ? JSON.parse(data) : [];
}

/**
 * Save conversation history to local storage.
 * @param chatInstanceId - The unique identifier for the chat instance.
 * @param title - The title of the conversation.
 * @param messages - An array of chat messages.
 * @param currentUser - Optional: The current user, used as fallback owner if only bot messages are present
 */
export function saveConversationHistory(
  chatInstanceId: string,
  title: string,
  messages: FrontChatMessage[],
  currentUser?: {id: string, email: string, name: string, image?: string}
): void {
  // Make a deep copy of messages to avoid mutating the original array
  let processedMessages = JSON.parse(JSON.stringify(messages));
  
  // Identify the conversation owner based on existing messages
  const conversationOwner = identifyConversationOwner(messages);
  
  // If no owner is identified and we have a current user, make them the owner
  if (!conversationOwner && currentUser && messages.length > 0) {
    // Use 'anonymous' as fallback ID if currentUser.id is empty
    const userId = currentUser.id || 'anonymous';
    
    // Add a system message to establish ownership
    processedMessages.unshift({
      id: `system-owner-${Date.now()}`,
      text: "Conversation initiated",
      isSent: true,
      chatInstanceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user: {
        id: userId,
        email: currentUser.email || '',
        name: currentUser.name || 'User',
        image: currentUser.image || ''
      }
    });
  }
  
  // Ensure every message has a valid user object with at least an ID
  processedMessages = processedMessages.map((msg: FrontChatMessage) => {
    if (!msg.user || !msg.user.id) {
      return {
        ...msg,
        user: {
          ...(msg.user || {}),
          id: (msg.user && msg.user.id) || 'anonymous'
        }
      };
    }
    return msg;
  });
  
  const history = {
    title,
    messages: processedMessages,
    lastUpdated: new Date().toISOString(),
  };
  
  try {
    localStorage.setItem(`chat-${chatInstanceId}-history`, JSON.stringify(history));
    
    // Also update the legacy storage format for backward compatibility
    localStorage.setItem(`chatMessages[${chatInstanceId}]`, JSON.stringify(processedMessages));
  } catch (error) {
    console.error('Error saving conversation history:', error);
  }
}

/**
 * Load conversation history from local storage.
 * @param chatInstanceId - The unique identifier for the chat instance.
 * @returns The conversation history with default values if not found.
 */
export function loadConversationHistory(
  chatInstanceId: string
): { title: string; messages: FrontChatMessage[]; lastUpdated: string } {
  try {
    // First try to load from the new format
    const data = localStorage.getItem(`chat-${chatInstanceId}-history`);
    
    if (data) {
      const parsed = JSON.parse(data);
      return {
        title: parsed.title || "💬 Chat",
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        lastUpdated: parsed.lastUpdated || new Date().toISOString()
      };
    }
    
    // Fallback to legacy format
    const legacyData = localStorage.getItem(`chatMessages[${chatInstanceId}]`);
    if (legacyData) {
      const messages = JSON.parse(legacyData);
      return {
        title: localStorage.getItem(`chat-${chatInstanceId}-title`) || "💬 Chat",
        messages: Array.isArray(messages) ? messages : [],
        lastUpdated: new Date().toISOString()
      };
    }
    
    // Return default empty structure if nothing found
    return {
      title: "💬 Chat",
      messages: [],
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error loading conversation history:", error);
    return {
      title: "💬 Chat",
      messages: [],
      lastUpdated: new Date().toISOString()
    };
  }
}
