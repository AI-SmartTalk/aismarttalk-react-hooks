export interface FrontChatMessage {
  id: string;
  text: string;
  isSent: boolean;
  chatInstanceId: string;
  created_at: string;
  updated_at: string;
  isLocallyCreated?: boolean;
  user?: {
    id: number | string;
    email: string;
    name: string;
    image?: string;
    role?: string;
  };
  /** Server-persisted attachments — mirrors Message.metadata on the backend.
   *  Used for: imageMetadata, audioMetadata, platformMessageId. */
  metadata?: Record<string, any>;
}

export interface CTADTO {
  icon: string;
  title: string;
  description: string;
  message: string;
}

export interface ChatHistoryItem {
  id: string;
  title: string;
  messages: FrontChatMessage[];
  lastUpdated: string;
}