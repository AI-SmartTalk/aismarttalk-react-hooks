import { ChatHistoryItem } from '../types/chat';

/** Upsert admitted entries without loading unverified cached entries into UI state. */
export function persistScopedChatHistory(storageKey: string, entries: ChatHistoryItem[]): void {
  const key = `chat-conversations:${storageKey}`;
  let stored: ChatHistoryItem[] = [];
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(value)) stored = value.filter(item => typeof item?.id === 'string');
  } catch { /* A malformed optional cache can be replaced. */ }
  const ids = new Set(entries.map(item => item.id));
  localStorage.setItem(key, JSON.stringify([...entries, ...stored.filter(item => !ids.has(item.id))]));
}
