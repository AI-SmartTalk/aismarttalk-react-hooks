import { User } from "./users";

export interface ChatFeatures {
  smartadmin: boolean;
  canva: boolean;
}

export interface ChatConfig {
  apiUrl?: string;
  wsUrl?: string;
  cdnUrl?: string;
  apiToken?: string;
  features?: ChatFeatures;
  user?: User;
}

export const defaultFeatures: ChatFeatures = {
  smartadmin: false,
  canva: false,
};

export interface UseChatMessagesOptions {
  chatModelId: string;
  user: User;
  setUser: (user: User) => void;
  config?: ChatConfig;
  lang: string;
  isAdmin?: boolean;
}
