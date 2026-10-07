import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatHistoryItem } from '../types/chat';

type HistorySummary = Omit<ChatHistoryItem, 'messages'>;
type HistoryResponse = { conversations: HistorySummary[]; nextCursor: string | null };
type Page = { scope: string; items: ChatHistoryItem[]; cursor: string | null; loading: boolean; error: Error | null };
/** Server-backed personal history: bounded summary pages, no message bodies.
 * Identity/search changes invalidate in-flight responses and visible results. */
export function useConversationHistory({ apiUrl, chatModelId, token, userId, search = '' }: {
  apiUrl: string; chatModelId: string; token?: string; userId?: string; search?: string;
}) {
  const scope = JSON.stringify([apiUrl, chatModelId, userId, token, search]);
  const live = useRef(scope); live.current = scope;
  const pending = useRef<AbortController | null>(null);
  const empty: Page = { scope, items: [], cursor: null, loading: Boolean(token), error: null };
  const [page, setPage] = useState<Page>(empty);
  const current = page.scope === scope ? page : empty;
  const load = useCallback(async (cursor?: string) => {
    if (!token) return;
    if (cursor && pending.current) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setPage(previous => ({ ...(previous.scope === scope ? previous : empty), loading: true, error: null }));
    try {
      const query = new URLSearchParams({ chatModelId, limit: '20', ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) });
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/chat/conversations?${query}`, {
        headers: { Authorization: `Bearer ${token}`, 'x-use-chatbot-auth': 'true' }, signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error('Unable to load conversation history'), { status: response.status });
      const data: HistoryResponse = await response.json();
      if (!Array.isArray(data.conversations)) throw new Error('Invalid history response');
      if (controller.signal.aborted || live.current !== scope) return;
      setPage(previous => {
        const items = new Map((cursor && previous.scope === scope ? previous.items : []).map(item => [item.id, item]));
        data.conversations.forEach((item: HistorySummary) => items.set(item.id, { ...item, messages: [] }));
        return { scope, items: Array.from(items.values()), cursor: typeof data.nextCursor === 'string' ? data.nextCursor : null, loading: false, error: null };
      });
    } catch (error) {
      if (live.current === scope && pending.current === controller) setPage(previous => ({ ...(previous.scope === scope ? previous : empty), loading: false, error: error instanceof Error ? error : new Error('History unavailable') }));
    } finally { clearTimeout(timeout); if (pending.current === controller) pending.current = null; }
  }, [scope]);
  useEffect(() => {
    if (token) void load(); else setPage(empty);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [load]);
  const update = async (id: string, title?: string) => {
    if (!token) throw new Error('Authentication required');
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/api/chat/conversations/${encodeURIComponent(id)}?chatModelId=${encodeURIComponent(chatModelId)}`, {
      method: title === undefined ? 'DELETE' : 'PATCH', headers: { Authorization: `Bearer ${token}`, 'x-use-chatbot-auth': 'true', 'Content-Type': 'application/json' },
      ...(title !== undefined ? { body: JSON.stringify({ title }) } : {}),
    });
    if (!response.ok) throw new Error('Unable to update conversation history');
    if (live.current === scope) await load();
  };
  return { rename: (id: string, title: string) => update(id, title), remove: (id: string) => update(id), conversations: current.items, isLoading: current.loading, error: current.error,
    hasMore: Boolean(current.cursor), loadMore: () => current.cursor ? load(current.cursor) : Promise.resolve(), refresh: () => load() };
}
