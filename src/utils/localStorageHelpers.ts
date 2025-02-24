// src/utils/localStorageHelpers.ts

import { CTADTO } from "../types/chat";
import { FrontChatMessage } from "../types/chat";

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
 */
export function saveConversationHistory(
  chatInstanceId: string,
  title: string,
  messages: FrontChatMessage[]
): void {
  const history = {
    title,
    messages,
    lastUpdated: new Date().toISOString(),
  };
  localStorage.setItem(`chat-${chatInstanceId}-history`, JSON.stringify(history));
}

/**
 * Load conversation history from local storage.
 * @param chatInstanceId - The unique identifier for the chat instance.
 * @returns The conversation history or null if not found.
 */
export function loadConversationHistory(
  chatInstanceId: string
): { title: string; messages: FrontChatMessage[]; lastUpdated: string } | null {
  const data = localStorage.getItem(`chat-${chatInstanceId}-history`);
  return data ? JSON.parse(data) : null;
}
