import { useEffect, useState } from "react";
import { CTADTO } from "../../types/chat";

export interface WelcomeContent {
  starters: CTADTO[];
  suggestions: string[];
}

const EMPTY: WelcomeContent = { starters: [], suggestions: [] };

/** Keeps only well-formed starters/suggestions from an untrusted response. */
export function parseWelcomeContent(data: unknown): WelcomeContent {
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const starters = Array.isArray(body.starters)
    ? body.starters.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" &&
        typeof (item as any).title === "string" && typeof (item as any).message === "string")
      .map(item => ({
        title: item.title as string,
        message: item.message as string,
        icon: typeof item.icon === "string" ? item.icon : "",
        description: typeof item.description === "string" ? item.description : "",
      }))
    : [];
  const suggestions = Array.isArray(body.suggestions)
    ? body.suggestions.filter((item): item is string => typeof item === "string")
    : [];
  return { starters, suggestions };
}

/**
 * Public welcome content (starters + suggestions) shown before a conversation
 * exists, in lazy conversation mode. Failures are silent: the chat simply
 * renders without starters.
 */
export function useWelcomeContent({ enabled, apiUrl, apiToken, chatModelId, lang }: {
  enabled: boolean; apiUrl: string; apiToken?: string; chatModelId: string; lang: string;
}): WelcomeContent {
  const [content, setContent] = useState<WelcomeContent>(EMPTY);
  useEffect(() => {
    if (!enabled || !chatModelId) return;
    setContent(EMPTY);
    const controller = new AbortController();
    const headers: Record<string, string> = {};
    if (apiToken) headers.appToken = apiToken;
    const url = `${apiUrl.replace(/\/$/, "")}/api/public/chatModel/${encodeURIComponent(chatModelId)}/welcome?lang=${encodeURIComponent(lang)}`;
    fetch(url, { method: "GET", headers, signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setContent(data ? parseWelcomeContent(data) : EMPTY); })
      .catch(() => { if (!controller.signal.aborted) setContent(EMPTY); });
    return () => controller.abort();
  }, [enabled, apiUrl, apiToken, chatModelId, lang]);
  return enabled ? content : EMPTY;
}
