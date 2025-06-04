import { useEffect, useState } from 'react';
import { FetchCanvasResponse, UploadResponse } from '../../types/canvas';
import { defaultApiUrl } from '../../types/config';
import { ChatActionTypes } from '../../reducers/chatReducers';

/**
 * Props for the useFileUpload hook
 */
interface UseFileUploadProps {
  /** ID of the chat model to use */
  chatModelId: string;
  /** Chat instance ID */
  chatInstanceId: string;
  /** Optional configuration object */
  config?: {
    /** Base API URL */
    apiUrl?: string;
    /** CDN URL for canvas operations */
    cdnUrl?: string;
    /** API authentication token */
    apiToken?: string;
  };
  /** Optional user object */
  user?: {
    /** User's authentication token */
    token?: string;
    /** User's ID */
    id?: string;
    /** User's email */
    email?: string;
    /** User's name */
    name?: string;
  };
  /** Dispatch function from chat reducer */
  dispatch: Function;
}

export interface CanvasFullContent {
  id: string;
  content: string;
}

// Define LineUpdate interface matching the internal agents package structure
export interface LineUpdate {
  lineNumber: number;
  oldContent: string;
  newContent: string;
  timestamp: Date;
}

// Add interface for canvas live updates
export interface CanvasLiveUpdate {
  canvasId: string;
  updates: LineUpdate[];
}

export function useFileUpload({
  chatModelId, 
  chatInstanceId, 
  user, 
  config, 
  dispatch
}: UseFileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  console.log("config in useFileUpload", config);

  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalCdnUrl = config?.cdnUrl || defaultApiUrl;
  const finalApiToken = config?.apiToken || "";

  useEffect(() => {
    console.log("Fetching canvases");
    fetchCanvases().then((fetchedCanvases) => {
      dispatch({
        type: ChatActionTypes.SET_CANVASES,
        payload: { canvases: fetchedCanvases },
      });
    });
  }, []);

  const uploadFile = async (file: File): Promise<UploadResponse> => {
    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        appToken: finalApiToken,
      };

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers["Authorization"] = `Bearer ${user.token}`;
      }

      const response = await fetch(
        `${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        let errorMessage = `Upload failed with status ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // If response is not JSON, try to get text
          try {
            const textError = await response.text();
            if (textError) {
              errorMessage = textError;
            }
          } catch {
            // If we can't get text, stick with the default error message
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log("Uploaded file", data);
      return data;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to upload file';
      setError(errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    } finally {
      setIsUploading(false);
      refreshCanvases();
    }
  };

  const fetchCanvases = async (): Promise<CanvasFullContent[]> => {
    setIsFetching(true);
    setError(null);

    try {
      const response = await fetch(
        `${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`,
        {
          method: 'GET',
        }
      );

      if (!response.ok) {
        let errorMessage = `Failed to fetch canvases (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          try {
            const textError = await response.text();
            if (textError) {
              errorMessage = textError;
            }
          } catch {
            // Keep default error message
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log("Fetched canvases", data);
      return data;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch canvases';
      setError(errorMessage);
      return [];
    } finally {
      setIsFetching(false);
    }
  };

  const refreshCanvases = () => {
    console.log("Refreshing canvases");
    fetchCanvases().then((fetchedCanvases) => {
      dispatch({
        type: ChatActionTypes.SET_CANVASES,
        payload: { canvases: fetchedCanvases },
      });
    });
  };

  return {
    // File operations
    uploadFile,
    fetchCanvases,
        
    // State
    isUploading,
    isFetching,
    error,
    
    // Utility methods
    refreshCanvases,
    clearError: () => setError(null)
  };
}
