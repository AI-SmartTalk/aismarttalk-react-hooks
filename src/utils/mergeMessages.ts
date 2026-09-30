import { FrontChatMessage } from "../types/chat";

const temporary = (message: FrontChatMessage) => message.isLocallyCreated || /^(temp-|streaming-)/.test(message.id);

/** Persisted IDs identify messages, never text/time proximity. Two distinct
 * replies with identical text are legitimate. Only optimistic rows may be
 * reconciled by content, one-for-one, until their server ID becomes known. */
export function mergeMessages(existing: FrontChatMessage[], incoming: FrontChatMessage[]) {
  const merged = new Map(existing.map(message => [message.id, message]));
  for (const message of incoming) {
    const sameId = merged.get(message.id);
    if (sameId) {
      const oldTime = Date.parse(sameId.updated_at);
      const newTime = Date.parse(message.updated_at);
      if (Number.isFinite(oldTime) && Number.isFinite(newTime) && oldTime > newTime) continue;
      merged.set(message.id, { ...sameId, ...message,
        metadata: { ...sameId.metadata, ...message.metadata } });
      continue;
    }
    if (message.isLocallyCreated && Array.from(merged.values()).some(row =>
      row.isLocallyCreated && row.text === message.text && row.user?.id === message.user?.id &&
      Math.abs(Date.parse(row.created_at) - Date.parse(message.created_at)) < 500)) continue;
    const counterpart = Array.from(merged.values()).find(row =>
      temporary(row) !== temporary(message) && row.text.trim() === message.text.trim() &&
      row.isSent === message.isSent &&
      (row.user?.id === message.user?.id || (row.isSent && row.user?.id === "anonymous") ||
        (!row.isSent && (row.id.startsWith("streaming-") || message.id.startsWith("streaming-")))) &&
      Math.abs(Date.parse(row.created_at) - Date.parse(message.created_at)) < 60000);
    if (counterpart) {
      if (temporary(message)) continue;
      merged.delete(counterpart.id);
    }
    merged.set(message.id, message);
  }
  return Array.from(merged.values()).sort((a, b) =>
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}
