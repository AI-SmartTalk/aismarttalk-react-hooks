import { useEffect, useState, useCallback, useRef } from "react";
import { defaultApiUrl } from "../types/config";

type Identity = { token?: string; id?: string; email?: string; name?: string };
interface UseChatInstanceProps {
  chatModelId: string;
  lang: string;
  config?: { apiUrl?: string; apiToken?: string };
  user?: Identity;
  isAdmin?: boolean;
}

export function chatIdentity(user?: Identity): string {
  return user?.token && user.id && user.id !== 'anonymous' && user.id !== 'sys_anonymous'
    ? `user:${user.id}` : 'visitor';
}

export function chatInstanceStorageKey(apiUrl: string, modelId: string, user?: Identity, admin = false): string {
  let site = '';
  try {
    const host = new URLSearchParams(window.location.search).get('parentOrigin');
    site = host ? new URL(host).origin : document.referrer && window.parent !== window
      ? new URL(document.referrer).origin : window.location.origin;
  } catch { /* SSR or restricted browser */ }
  return `chatInstance:v2:${JSON.stringify([apiUrl.replace(/\/$/, ''), modelId, admin, chatIdentity(user), site])}`;
}

/** One owner for instance restoration, selection and creation. Never expose an
 * instance from another identity before the server has admitted continuation. */
export const useChatInstance = ({ chatModelId, lang, config, user, isAdmin = false }: UseChatInstanceProps) => {
  const apiUrl = (config?.apiUrl || defaultApiUrl).replace(/\/$/, '');
  const apiToken = config?.apiToken || '';
  const storageKey = chatInstanceStorageKey(apiUrl, chatModelId, user, isAdmin);
  const legacyKey = `chatInstanceId[${chatModelId}${isAdmin ? '-smartadmin' : '-standard'}]`;
  const [active, setActive] = useState({ scope: '', id: '' });
  const [error, setError] = useState<Error | null>(null);
  const [changing, setChanging] = useState(false);
  const context = useRef({ scope: storageKey, epoch: 0 });
  if (context.current.scope !== storageKey) context.current = { scope: storageKey, epoch: context.current.epoch + 1 };
  const pending = useRef<{ key: string; controller: AbortController; promise: Promise<string | null> } | null>(null);
  const mounted = useRef(true);
  const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const store = (key: string, id: string) => { try { localStorage.setItem(key, id); } catch { /* Storage may be unavailable */ } };

  const resolve = useCallback((overrideUser?: Identity, requestedId?: string, fresh = false): Promise<string | null> => {
    const identity = overrideUser || user;
    const scope = chatInstanceStorageKey(apiUrl, chatModelId, identity, isAdmin);
    const epoch = context.current.epoch;
    const key = JSON.stringify([scope, identity?.token, requestedId || '', fresh]);
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
      method: 'POST', headers, signal: controller.signal,
      body: JSON.stringify({ chatModelId, lang, userEmail: identity?.email || 'anonymous@example.com', userName: identity?.name || 'Anonymous',
        ...(id ? { resumeOnly: true, chatInstanceId: id } : {}) }),
    });
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const promise = (async () => {
      try {
        const previousScope = `chatInstance:v2:${JSON.stringify([apiUrl, chatModelId, isAdmin, chatIdentity(identity)])}`;
        const saved = fresh ? null : requestedId || read(scope) || read(previousScope) || read(legacyKey);
        let response = isAdmin && saved
          ? await fetch(`${apiUrl}/api/chat/history/${saved}`, { headers, signal: controller.signal })
          : await post(saved || undefined);
        if (!response.ok && saved && !isAdmin) {
          const failure = await response.json().catch(() => ({}));
          // Only a missing/unowned instance permits a fresh conversation. An
          // expired identity, ban, quota refusal or outage must not be bypassed.
          if (response.status === 404 || (response.status === 403 && failure.code === 'CONVERSATION_ACCESS_DENIED')) {
            response = await post();
          } else throw Object.assign(new Error(`Failed to resume chat instance: HTTP ${response.status}`), { status: response.status, code: failure.code });
        }
        if (!response.ok) { const failure = await response.json().catch(() => ({})); throw Object.assign(new Error(`Failed to create chat instance: HTTP ${response.status}`), { status: response.status, code: failure.code }); }
        const data = await response.json();
        if (isAdmin && saved && !data.chatInstanceId) data.chatInstanceId = saved;
        if (typeof data.chatInstanceId !== 'string' || !data.chatInstanceId) throw new Error('Chat instance response is missing its ID');
        if (!current()) return null;
        store(scope, data.chatInstanceId);
        // Legacy storage is never written again; each identity has its own key.
        try { localStorage.removeItem(legacyKey); } catch { /* optional */ }
        if (context.current.scope === scope) setActive({ scope, id: data.chatInstanceId });
        return data.chatInstanceId;
      } catch (cause) {
        if (mounted.current && context.current.epoch === epoch && pending.current?.controller === controller) setError(cause instanceof Error ? cause : new Error('Failed to initialize chat instance'));
        return null;
      } finally {
        clearTimeout(timeout);
        if (pending.current?.controller === controller) { pending.current = null; if (mounted.current) setChanging(false); }
      }
    })();
    pending.current = { key, controller, promise };
    return promise;
  }, [apiUrl, apiToken, chatModelId, lang, user?.id, user?.token, user?.email, user?.name, isAdmin, legacyKey]);

  const getNewInstance = useCallback((identity?: Identity) => resolve(identity, undefined, true), [resolve]);
  const selectInstance = useCallback((id: string) => resolve(undefined, id), [resolve]);
  const cleanup = useCallback(async () => {
    pending.current?.controller.abort();
    context.current.epoch++;
    setActive({ scope: storageKey, id: '' });
    try { localStorage.removeItem(storageKey); } catch { /* optional */ }
  }, [storageKey]);

  useEffect(() => {
    mounted.current = true;
    void resolve();
    return () => { mounted.current = false; pending.current?.controller.abort(); };
  }, [storageKey, user?.token, apiToken, resolve]);

  // Cross-tab instance selection stays scoped to the active identity.
  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue && event.newValue !== active.id) void selectInstance(event.newValue);
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [storageKey, active.id, selectInstance]);

  return { chatInstanceId: active.scope === storageKey ? active.id : '', getNewInstance, selectInstance,
    setChatInstanceId: selectInstance, error, isChanging: changing, retry: resolve,
    storageKey, cleanup };
};
export default useChatInstance;
