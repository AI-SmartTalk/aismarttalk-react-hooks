import { useCallback, useEffect, useRef } from "react";

interface SyncOptions {
  chatInstanceId: string;
  apiUrl: string;
  apiToken?: string;
  userToken?: string;
  socketStatus: string;
  onHistory: (data: any) => void;
}

/** HTTP owns the recovery cursor. Socket events never advance it: receiving
 * a later event cannot prove that all preceding events reached the browser. */
export function useConversationSync(options: SyncOptions) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<{
    controller?: AbortController;
    promise?: Promise<void>;
    cursor?: string;
    failures: number;
    denied: boolean;
    nextAttempt: number;
  }>({ failures: 0, denied: false, nextAttempt: 0 });

  const sync = useCallback((): Promise<void> => {
    const current = session.current;
    const config = latest.current;
    if (!config.chatInstanceId || current.denied) return Promise.resolve();
    if (current.promise) return current.promise;
    const controller = new AbortController();
    current.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    current.promise = Promise.resolve().then(async () => {
      try {
        if (controller.signal.aborted || session.current !== current || current.denied) return;
        const headers: Record<string, string> = {};
        if (config.apiToken) headers.appToken = config.apiToken;
        if (config.userToken) {
          headers.Authorization = `Bearer ${config.userToken}`;
          headers["x-use-chatbot-auth"] = "true";
        }
        const since = current.cursor
          ? `?since=${encodeURIComponent(new Date(Date.parse(current.cursor) - 5000).toISOString())}`
          : "";
        const response = await fetch(`${config.apiUrl}/api/chat/history/${config.chatInstanceId}${since}`, {
          headers, signal: controller.signal, cache: "no-store",
        });
        if ([401, 403, 404].includes(response.status)) {
          current.denied = true;
          return;
        }
        if (!response.ok) throw new Error(`History sync HTTP ${response.status}`);
        const data = await response.json();
        if (controller.signal.aborted || session.current !== current) return;
        config.onHistory(data);
        if (data.serverTime && Number.isFinite(Date.parse(data.serverTime))) {
          current.cursor = data.serverTime;
        }
        current.failures = 0;
        current.nextAttempt = 0;
      } catch {
        if (session.current === current) {
          current.failures++;
          current.nextAttempt = Date.now() + Math.min(60000, 5000 * 2 ** (current.failures - 1));
        }
      } finally {
        clearTimeout(timeout);
        current.promise = undefined;
        current.controller = undefined;
      }
    });
    return current.promise;
  }, []);

  useEffect(() => {
    const previous = session.current;
    previous.controller?.abort();
    const current = { failures: 0, denied: false, nextAttempt: 0 };
    session.current = current;
    let timer: ReturnType<typeof setTimeout>;
    let open = true;
    const schedule = () => {
      clearTimeout(timer);
      if (current.denied || session.current !== current) return;
      if (document.visibilityState === "hidden") return;
      const delay = current.failures
        ? Math.max(1000, current.nextAttempt - Date.now())
        : latest.current.socketStatus !== "connected" ? 5000 : open ? 15000 : 45000;
      timer = setTimeout(async () => { await sync(); schedule(); }, delay);
    };
    const recover = async () => { await sync(); schedule(); };
    const visibility = () => {
      if (document.visibilityState === "hidden") clearTimeout(timer);
      else void recover();
    };
    const widgetVisibility = (event: Event) => {
      open = (event as CustomEvent<boolean>).detail;
      if (open) void recover();
      else schedule();
    };
    void recover();
    window.addEventListener("online", recover);
    window.addEventListener("pageshow", recover);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("aismarttalk:visibility", widgetVisibility);
    return () => {
      clearTimeout(timer);
      current.denied = true;
      session.current.controller?.abort();
      window.removeEventListener("online", recover);
      window.removeEventListener("pageshow", recover);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("aismarttalk:visibility", widgetVisibility);
    };
  }, [options.chatInstanceId, options.apiUrl, options.apiToken, options.userToken, sync]);

  return sync;
}
