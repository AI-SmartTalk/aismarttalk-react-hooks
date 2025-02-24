export interface FrontChatMessage {
  id: string;
  text: string;
  isSent: boolean;
  chatInstanceId: string;
  created_at: string;
  updated_at: string;
  user?: {
    id: number | string;
    email: string;
    name: string;
    image?: string;
  };
}

export interface CTADTO {
  icon: string;
  title: string;
  description: string;
  message: string;
}