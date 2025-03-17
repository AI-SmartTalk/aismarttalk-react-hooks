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
  let processedMessages = [...messages];
  
  // CORRECTION CRITIQUE: Vérifier si la conversation a un propriétaire non-bot
  const conversationOwner = identifyConversationOwner(messages);
  
  // Si tous les messages sont de bots et que nous avons un utilisateur courant disponible
  if (!conversationOwner && currentUser && messages.length > 0) {      
    // Ajouter un message système invisible pour définir l'utilisateur courant comme propriétaire
    processedMessages.unshift({
      id: `system-owner-${Date.now()}`,
      text: "Conversation initiée",
      isSent: true,
      chatInstanceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      user: {
        id: currentUser.id,
        email: currentUser.email || '',
        name: currentUser.name || 'Utilisateur',
        image: currentUser.image || ''
      }
    });
  }
  
  const history = {
    title,
    messages: processedMessages,
    lastUpdated: new Date().toISOString(),
  };
  
  localStorage.setItem(`chat-${chatInstanceId}-history`, JSON.stringify(history));
  
  // TRÈS IMPORTANT: Mettre également à jour la sauvegarde dans chatMessages[ID]
  localStorage.setItem(`chatMessages[${chatInstanceId}]`, JSON.stringify(processedMessages));
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
