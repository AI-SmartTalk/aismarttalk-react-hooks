import { User } from "./users";

export interface ChatFeatures {
  canvasEnabled?: boolean;
  smartadmin?: boolean;
  suggestions?: boolean;
  uploadEnabled?: boolean;
  fileList?: boolean;
}

export interface ChatConfig {
  apiUrl?: string;
  wsUrl?: string;
  cdnUrl?: string;
  apiToken?: string;
  features?: ChatFeatures;
  user?: User;
  debug?: boolean;
}

export const defaultFeatures: ChatFeatures = {
  canvasEnabled: true,
  smartadmin: false,
  suggestions: true,
  uploadEnabled: true,
  fileList: true,
};

/**
 * Error type definitions for the chat application
 * Used to categorize errors for consistent handling
 */
export type ChatErrorType = 
  | "auth"        // Authentication failures (401)
  | "permission"  // Permission issues (403)
  | "rate_limit"  // Rate limiting (429)
  | "validation"  // Request validation failures (400)
  | "not_found"   // Resource not found (404) 
  | "server"      // Server-side errors (500, 502, 503, 504)
  | "network"     // Network connectivity issues
  | "client"      // Other client errors
  | "api-error"   // API-specific errors
  | "unknown";    // Uncategorized errors

/**
 * Structured error information returned by the hook
 */
export interface ChatError {
  /** Human-readable error message */
  message: string | null;
  
  /** Type of error for categorization */
  type: ChatErrorType | null;
  
  /** HTTP status code if applicable */
  code: number | null;
}

export interface UseChatMessagesOptions {
  chatModelId: string;
  user: User;
  setUser: (user: User) => void;
  config?: ChatConfig;
  lang?: string;
  isAdmin?: boolean;
  debug?: boolean;
}
