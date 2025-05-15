import { FrontChatMessage } from "../types/chat";

/**
 * Identifie l'utilisateur propriétaire d'une conversation à partir des messages.
 * Si un utilisateur non-bot est présent, il sera considéré comme propriétaire.
 * Si seuls des bots sont présents, retourne null.
 *
 * @param messages Les messages de la conversation
 * @returns L'utilisateur propriétaire ou null si aucun trouvé
 */
export const identifyConversationOwner = (
  messages: FrontChatMessage[]
): FrontChatMessage["user"] | null => {
  // Recherche d'abord un utilisateur qui n'est pas un bot
  const nonBotMessage = messages.find(
    (msg) => msg.user && (!("role" in msg.user) || msg.user.role !== "BOT")
  );

  if (nonBotMessage && nonBotMessage.user) {
    return nonBotMessage.user;
  }

  // Si aucun utilisateur non-bot n'est trouvé, retourne null
  return null;
};

/**
 * Détermine si un message doit être marqué comme envoyé (isSent) selon les critères spécifiés.
 * Un message est considéré comme envoyé si:
 * 1. Le message n'a pas d'utilisateur OU
 * 2. L'utilisateur est l'utilisateur initial (anonymous) OU
 * 3. L'utilisateur est l'utilisateur actuel
 *
 * IMPORTANT: Les messages provenant d'un bot (role="BOT") sont toujours marqués comme non envoyés.
 *
 * @param message Le message à évaluer
 * @param currentUserId ID de l'utilisateur actuel
 * @param currentUserEmail Email de l'utilisateur actuel
 * @returns true si le message doit être marqué comme envoyé, false sinon
 */
export const shouldMessageBeSent = (
  message: FrontChatMessage,
  currentUserId?: string,
  currentUserEmail?: string
): boolean => {
  // Logs pour faciliter le débogage
  const isBot =
    message.user && "role" in message.user && message.user.role === "BOT";
  const hasNoUser = !message.user;
  const isInitialUser =
    message.user?.id === "anonymous" ||
    message.user?.email === "anonymous@example.com";
  const isCurrentUser =
    (currentUserId &&
      currentUserId !== "anonymous" &&
      message.user?.id === currentUserId) ||
    (currentUserEmail && message.user?.email === currentUserEmail);

  if (isBot) {
    return false;
  }

  // Le message doit être marqué comme envoyé si l'une des conditions est remplie
  return !!(hasNoUser || isInitialUser || isCurrentUser);
};
