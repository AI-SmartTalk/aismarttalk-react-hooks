/** A server-issued capability belongs to one conversation, never to the shared anonymous user. */
export function conversationVisitorHeaders(id: string): Record<string, string> {
  try {
    const token = localStorage.getItem(`chatVisitorToken:v1:${id}`);
    return token ? { 'x-chat-visitor-token': token } : {};
  } catch { return {}; }
}
export function storeConversationVisitorToken(id: string, token: string): void {
  try { localStorage.setItem(`chatVisitorToken:v1:${id}`, token); } catch { /* Restricted storage. */ }
}

export function reportConversationAccessFailure(id: string, status: number, code: string, pendingMessage?: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('aismarttalk:conversation-access-failure', { detail: { conversationId: id, status, code, pendingMessage } }));
}
