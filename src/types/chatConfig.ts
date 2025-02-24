import { User } from "./users";

export interface ChatConfig {
  apiUrl?: string;
  wsUrl?: string;
  cdnUrl?: string;
  apiToken?: string;
}

export interface UseChatMessagesOptions {
  chatModelId: string;
  chatInstanceId: string;  
  user: User;
  setUser: (user: User) => void;
  config?: ChatConfig;
}
