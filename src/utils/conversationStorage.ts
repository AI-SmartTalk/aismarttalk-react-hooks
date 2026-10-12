/** Keep admissions and capabilities together when persistent storage is blocked.
 * Never silently create a new conversation if neither browser store works. */
export function readConversationStorage(key: string): string | null {
  // A fallback write is newer than a stale, still-readable local value. A
  // successful local write removes this session override in the writer below.
  try { const value = sessionStorage.getItem(key); if (typeof value === "string") return value; } catch { /* Try persistent storage. */ }
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeConversationStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    if (localStorage.getItem(key) === value) {
      try { sessionStorage.removeItem(key); } catch { /* Optional cleanup. */ }
      return;
    }
  } catch { /* Try session storage. */ }
  try {
    sessionStorage.setItem(key, value);
    if (sessionStorage.getItem(key) === value) return;
  } catch { /* Fail closed below. */ }
  throw Object.assign(new Error('Browser storage is unavailable. Allow storage to retain this conversation.'), { code: 'CONVERSATION_STORAGE_UNAVAILABLE' });
}
export function removeConversationStorage(key: string): void {
  try { localStorage.removeItem(key); } catch { /* Optional. */ }
  try { sessionStorage.removeItem(key); } catch { /* Optional. */ }
}
export function newConversationCreationKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
