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