import { User } from "./users";

export interface ChatConfig {
  chatModelId: string;
  apiUrl: string;
  wsUrl: string;
  cdnUrl: string;
  apiToken?: string;
}

export interface UseChatMessagesOptions {
  chatInstanceId: string;
  isOpen: boolean;
  user: User;
  setUser: (user: User) => void;
  config?: ChatConfig;
}
