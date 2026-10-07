import { conversationVisitorHeaders } from "./conversationVisitorToken";
/** Migrate legacy browser history only after write admission for each instance.
 * Inbox read permission and cached owner labels are not ownership credentials. */
export async function restoreScopedChatHistory(options: {
  storageKey: string; modelId: string; apiUrl: string; token?: string; apiToken?: string; signal: AbortSignal; onProgress?: (items: any[]) => void;
}): Promise<any[]> {
  const key = `chat-conversations:${options.storageKey}`;
  const parse = (value: string | null): any[] => { try { const data = JSON.parse(value || '[]'); return Array.isArray(data) ? data : []; } catch { return []; } };
  let scoped: any[]; let legacy: any[];
  try {
    scoped = parse(localStorage.getItem(key));
    let previousKey = '';
    try { const parts = JSON.parse(options.storageKey.slice('chatInstance:v2:'.length)); if (parts.length === 5) { parts.pop(); previousKey = `chat-conversations:chatInstance:v2:${JSON.stringify(parts)}`; } } catch { /* not a v2 key */ }
    legacy = [...parse(localStorage.getItem(`chat-conversations-${options.modelId}`)), ...parse(localStorage.getItem(previousKey))];
  } catch { return []; }
  const seen = new Set<string>();
  const remaining = [...scoped, ...legacy].filter(item => { if (typeof item?.id !== 'string' || seen.has(item.id)) return false; seen.add(item.id); return true; });
  const restored: any[] = [];
  const headers: Record<string, string> = { 'Content-Type': 'application/json', appToken: options.apiToken || '' };
  if (options.token) { headers.Authorization = `Bearer ${options.token}`; headers['x-use-chatbot-auth'] = 'true'; }
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, remaining.length) }, async () => {
    while (index < remaining.length && !options.signal.aborted) {
      const item = remaining[index++];
      try {
        const response = await fetch(`${options.apiUrl}/api/chat/createInstance`, {
          method: 'POST', headers: { ...headers, ...conversationVisitorHeaders(item.id) }, signal: options.signal,
          body: JSON.stringify({ chatModelId: options.modelId, chatInstanceId: item.id, resumeOnly: true }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.chatInstanceId === item.id && !options.signal.aborted) {
            restored.push(item);
            options.onProgress?.([...restored]);
          }
        }
      } catch { /* A failed check cannot expose cached content. */ }
    }
  }));
  const result = restored;
  if (restored.length) {
    try { localStorage.setItem(key, JSON.stringify([...scoped, ...restored.filter(item => !scoped.some(existing => existing.id === item.id))])); } catch { /* optional storage */ }
  }
  return result;
}
