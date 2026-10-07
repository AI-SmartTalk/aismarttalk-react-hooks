import { useEffect, useState, useCallback, useRef } from "react";
import { conversationVisitorHeaders, storeConversationVisitorToken } from "../utils/conversationVisitorToken";
import { defaultApiUrl } from "../types/config";

type Identity = { token?: string; id?: string; email?: string; name?: string };
interface UseChatInstanceProps {
  chatModelId: string;
  lang: string;
  config?: { apiUrl?: string; apiToken?: string; storageNamespace?: string };
  user?: Identity;
  isAdmin?: boolean;
}

export function chatIdentity(user?: Identity): string {
  return user?.token && user.id && user.id !== 'anonymous' && user.id !== 'sys_anonymous'
    ? `user:${user.id}` : 'visitor';
}

export function chatInstanceStorageKey(apiUrl: string, modelId: string, user?: Identity, admin = false, storageNamespace = ''): string {
  let site = '';
  try {
    const host = new URLSearchParams(window.location.search).get('parentOrigin');
    site = host ? new URL(host).origin : document.referrer && window.parent !== window
      ? new URL(document.referrer).origin : window.location.origin;
  } catch { /* SSR or restricted browser */ }
  const parts: unknown[] = [apiUrl.replace(/\/$/, ''), modelId, admin, chatIdentity(user), site];
  if (storageNamespace) parts.push(storageNamespace);
  return `chatInstance:v2:${JSON.stringify(parts)}`;
}

export function chatActiveSelectionKey(apiUrl: string, modelId: string, admin = false, storageNamespace = '', user?: Identity): string {
  const parts = JSON.parse(chatInstanceStorageKey(apiUrl, modelId, user, admin, storageNamespace).slice('chatInstance:v2:'.length));
  // Regular embeds share the current selection between tabs. A namespaced
  // preview keeps selections identity-scoped so an admin thread can never
  // become the anonymous visitor preview's implicit resume target.
  if (!storageNamespace) parts.splice(3, 1);
  return `chatActive:v3:${JSON.stringify(parts)}`;
}
type Selection = { id: string; identity: string; fresh?: boolean };

/** One owner for instance restoration, selection and creation. Never expose an
 * instance from another identity before the server has admitted continuation. */
export const useChatInstance = ({ chatModelId, lang, config, user, isAdmin = false }: UseChatInstanceProps) => {
  const apiUrl = (config?.apiUrl || defaultApiUrl).replace(/\/$/, '');
  const apiToken = config?.apiToken || '';
  const storageNamespace = config?.storageNamespace || '';
  const storageKey = chatInstanceStorageKey(apiUrl, chatModelId, user, isAdmin, storageNamespace);
  const selectionKey = chatActiveSelectionKey(apiUrl, chatModelId, isAdmin, storageNamespace, user);
  const legacyKey = `chatInstanceId[${chatModelId}${isAdmin ? '-smartadmin' : '-standard'}]`;
  const [active, setActive] = useState({ scope: '', id: '' });
  const [error, setError] = useState<Error | null>(null);
  const [changing, setChanging] = useState(false);
  const context = useRef({ scope: storageKey, epoch: 0 });
  if (context.current.scope !== storageKey) context.current = { scope: storageKey, epoch: context.current.epoch + 1 };
  const pending = useRef<{ key: string; controller: AbortController; promise: Promise<string | null> } | null>(null);
  const mounted = useRef(true);
  const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const readSelection = (): Selection | null => {
    try { const value = JSON.parse(read(selectionKey) || 'null');
      return value && typeof value.id === 'string' && typeof value.identity === 'string' ? value : null;
    } catch { return null; }
  };
  const store = (key: string, id: string) => { try { localStorage.setItem(key, id); } catch { /* Storage may be unavailable */ } };

  const resolve = useCallback((overrideUser?: Identity, requestedId?: string, fresh = false, publish = true): Promise<string | null> => {
    const identity = overrideUser || user;
    const scope = chatInstanceStorageKey(apiUrl, chatModelId, identity, isAdmin, storageNamespace);
    const epoch = context.current.epoch;
    const key = JSON.stringify([scope, identity?.token, requestedId || '', fresh, publish]);
    if (pending.current?.key === key && !pending.current.controller.signal.aborted) return pending.current.promise;
    pending.current?.controller.abort();
    const controller = new AbortController();
    const current = () => mounted.current && !controller.signal.aborted && context.current.epoch === epoch;
    setChanging(true);
    setError(null);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', appToken: apiToken };
    if (identity?.token) { headers.Authorization = `Bearer ${identity.token}`; headers['x-use-chatbot-auth'] = 'true'; }
    const url = isAdmin ? `${apiUrl}/api/admin/chatModel/${chatModelId}/smartadmin/instance` : `${apiUrl}/api/chat/createInstance`;
    const post = (id?: string) => fetch(url, {
      method: 'POST', headers: { ...headers, ...conversationVisitorHeaders(id || '') }, signal: controller.signal,
      body: JSON.stringify({ chatModelId, lang, userEmail: identity?.email || 'anonymous@example.com', userName: identity?.name || 'Anonymous',
        ...(id ? { resumeOnly: true, chatInstanceId: id, ...(publish && identity?.token && Object.keys(conversationVisitorHeaders(id)).length ? { claimAnonymous: true } : {}) } : {}) }),
    });
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const promise = (async () => {
      try {
        const admit = async () => {
          if (!current()) return null;
          const previousScope = storageNamespace ? '' : `chatInstance:v2:${JSON.stringify([apiUrl, chatModelId, isAdmin, chatIdentity(identity)])}`;
          const selection = readSelection();
          const saved = fresh || selection?.fresh ? null : requestedId || selection?.id || read(scope) || (previousScope ? read(previousScope) : null) || (!storageNamespace ? read(legacyKey) : null);
          let resuming = Boolean(saved);
          let response = isAdmin && saved
            ? await fetch(`${apiUrl}/api/chat/history/${saved}`, { headers, signal: controller.signal })
            : await post(saved || undefined);
          if (!response.ok && saved && !isAdmin) {
            const failure = await response.json().catch(() => ({}));
            // Access loss is a locked selection, never an implicit new thread.
            throw Object.assign(new Error(`Failed to resume chat instance: HTTP ${response.status}`), { status: response.status, code: failure.code, conversationId: saved });
          }
          if (!response.ok) { const failure = await response.json().catch(() => ({})); throw Object.assign(new Error(`Failed to create chat instance: HTTP ${response.status}`), { status: response.status, code: failure.code }); }
          const data = await response.json();
          if (isAdmin && saved && !data.chatInstanceId) data.chatInstanceId = saved;
          if (typeof data.chatInstanceId !== 'string' || !data.chatInstanceId) throw new Error('Chat instance response is missing its ID');
          // A resume response is an admission of this exact conversation, not a
          // creation. Fail closed against older/incompatible API deployments.
          if (resuming && data.chatInstanceId !== saved) {
            throw Object.assign(new Error('Server returned a different conversation during resume'), { code: 'CONVERSATION_RESUME_MISMATCH' });
          }
          if (!current()) return null;
          // Receiving a storage event must not publish it back to other tabs.
          // Late events and responses must not override a newer shared selection.
          if (!publish && readSelection()?.id !== requestedId) return null;
          if (typeof data.visitorToken === 'string') storeConversationVisitorToken(data.chatInstanceId, data.visitorToken);
          if (publish) {
            store(scope, data.chatInstanceId);
            store(selectionKey, JSON.stringify({ id: data.chatInstanceId, identity: chatIdentity(identity) }));
          }
          // Legacy storage is never written again; each identity has its own key.
          if (!storageNamespace) {
            try { localStorage.removeItem(legacyKey); } catch { /* optional */ }
          }
          if (context.current.scope === scope) setActive({ scope, id: data.chatInstanceId });
          return data.chatInstanceId;
        };
        // Serialize admission across tabs and re-read the shared selection
        // inside the lock, so logout creates one fresh visitor conversation.
        return typeof navigator !== 'undefined' && navigator.locks
          ? await navigator.locks.request(selectionKey, { signal: controller.signal }, admit)
          : await admit();
      } catch (cause) {
        if (mounted.current && context.current.epoch === epoch && pending.current?.controller === controller) {
          setError(cause instanceof Error ? cause : new Error('Failed to initialize chat instance'));
          if ([401, 403].includes((cause as any)?.status)) setActive({ scope, id: '' });
        }
        return null;
      } finally {
        clearTimeout(timeout);
        if (pending.current?.controller === controller) { pending.current = null; if (mounted.current) setChanging(false); }
      }
    })();
    pending.current = { key, controller, promise };
    return promise;
  }, [apiUrl, apiToken, chatModelId, lang, user?.id, user?.token, user?.email, user?.name, isAdmin, legacyKey, selectionKey, storageNamespace]);

  const getNewInstance = useCallback((identity?: Identity) => resolve(identity, undefined, true), [resolve]);
  const selectInstance = useCallback((id: string) => resolve(undefined, id), [resolve]);
  const beginAnonymousSession = useCallback(() => {
    pending.current?.controller.abort();
    context.current.epoch++;
    setActive({ scope: '', id: '' });
    const freshVisitor = JSON.stringify({ id: '', identity: 'visitor', fresh: true });
    store(selectionKey, freshVisitor);
    const visitorSelectionKey = chatActiveSelectionKey(apiUrl, chatModelId, isAdmin, storageNamespace, { id: 'anonymous' });
    if (visitorSelectionKey !== selectionKey) store(visitorSelectionKey, freshVisitor);
  }, [apiUrl, chatModelId, isAdmin, selectionKey, storageNamespace]);
  const cleanup = useCallback(async () => {
    pending.current?.controller.abort();
    context.current.epoch++;
    setActive({ scope: storageKey, id: '' });
    try { localStorage.removeItem(storageKey); } catch { /* optional */ }
  }, [storageKey, selectionKey]);

  useEffect(() => {
    mounted.current = true;
    void resolve();
    return () => { mounted.current = false; pending.current?.controller.abort(); };
  }, [storageKey, user?.token, apiToken, resolve]);

  useEffect(() => {
    const denied = (event: Event) => {
      const failure = (event as CustomEvent).detail;
      if (!failure || readSelection()?.id !== failure.conversationId) return;
      pending.current?.controller.abort(); context.current.epoch++;
      setActive({ scope: storageKey, id: '' }); setChanging(false);
      setError(Object.assign(new Error('Authentication or conversation access required'), failure));
    };
    window.addEventListener('aismarttalk:conversation-access-failure', denied);
    return () => window.removeEventListener('aismarttalk:conversation-access-failure', denied);
  }, [selectionKey, storageKey]);

  // A shared active selection is separate from per-identity history. Receiving
  // it never echoes it back, and stale events/responses cannot replace it.
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key !== selectionKey || read(selectionKey) !== event.newValue) return;
      const selection = readSelection();
      if (!selection || selection.fresh || !selection.id || selection.id === active.id) return;
      void resolve(undefined, selection.id, false, false);
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [selectionKey, active.id, resolve]);

  return { chatInstanceId: active.scope === storageKey ? active.id : '', getNewInstance, selectInstance,
    setChatInstanceId: selectInstance, error, isChanging: changing, retry: resolve,
    storageKey, selectionKey, beginAnonymousSession, cleanup };
};
export default useChatInstance;
