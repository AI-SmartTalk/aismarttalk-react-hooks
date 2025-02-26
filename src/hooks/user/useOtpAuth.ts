import { useState } from "react";
import { defaultApiUrl } from '../../types/config';
/**
 * Props for the useOtpAuth hook
 */
interface UseOtpAuthProps {
  /** Language code for authentication messages */
  lang: string;
  /** Optional configuration object */
  config?: {
    /** Base API URL */
    apiUrl?: string;
  };
  /** Optional chat model ID */
  chatModelId?: string;
}

/**
 * Response type for authentication operations
 */
interface AuthResponse<T = any> {
  /** Whether the operation was successful */
  success?: boolean;
  /** Response data when successful */
  data?: T;
  /** Error message when unsuccessful */
  error?: string;
}

/**
 * OAuth credentials object
 */
interface OAuthCredentials {
  /** Chat model ID */
  chatModelId: string;
  /** User's OAuth token */
  userToken: string;
  /** OAuth source (provider) */
  source: string;
}

/**
 * Hook to manage OTP and OAuth authentication
 * 
 * Provides methods for requesting one-time passwords, authenticating with OTPs,
 * and authenticating with OAuth tokens.
 * 
 * @param props - Configuration options for the authentication
 * @returns Object containing authentication methods and loading state
 */
export const useOtpAuth = ({
  lang,
  config,
  chatModelId
}: UseOtpAuthProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const finalApiUrl = config?.apiUrl || defaultApiUrl;

  /**
   * Requests a one-time password to be sent to the specified email
   * 
   * @param email - User's email address
   * @returns Object with success or error information
   */
  const requestOtp = async (email: string): Promise<AuthResponse> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        `${finalApiUrl}/api/auth/request-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.toLowerCase(),
            lang,
            chatModelId,
          }),
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to request OTP: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      const errorDetails = {
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
      };
      console.error('Error requesting OTP:', errorDetails);
      setError(err instanceof Error ? err : new Error('Failed to request OTP'));
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Authenticates a user with the provided email and OTP code
   * 
   * @param email - User's email address
   * @param code - One-time password code
   * @param chatInstanceId - Optional chat instance ID
   * @returns Object with success or error information
   */
  const loginWithOtp = async (email: string, code: string, chatInstanceId?: string): Promise<AuthResponse> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${finalApiUrl}/api/auth/otp-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, chatInstanceId }),
      });
      
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many requests. Please try again later.");
        }
        const errorText = await response.text();
        throw new Error(`Failed to log in: ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      const errorDetails = {
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
      };
      console.error('Error logging in with OTP:', errorDetails);
      setError(err instanceof Error ? err : new Error('Failed to log in with OTP'));
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Authenticates a user with OAuth credentials
   * 
   * @param credentials - OAuth credentials object
   * @returns Object with success or error information
   */
  const loginWithOauth = async (credentials: OAuthCredentials): Promise<AuthResponse> => {
    const { chatModelId, userToken, source } = credentials;
    setLoading(true);
    setError(null);

    if (!chatModelId || !userToken || !source) {
      setLoading(false);
      return { error: "Missing required credentials" };
    }

    try {
      const response = await fetch(`${finalApiUrl}/api/auth/oauth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatModelId, source, oauthToken: userToken }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OAuth login failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (err) {
      const errorDetails = {
        message: err instanceof Error ? err.message : 'Unknown error',
        stack: err instanceof Error ? err.stack : undefined,
      };
      console.error('Error during OAuth token login:', errorDetails);
      setError(err instanceof Error ? err : new Error('Failed to log in with OAuth'));
      return { error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      setLoading(false);
    }
  };

  return { 
    requestOtp, 
    loginWithOtp, 
    loginWithOauth, 
    loading,
    error
  };
};

export default useOtpAuth;
