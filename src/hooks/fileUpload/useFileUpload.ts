import { useState } from 'react';
import { UploadResponse } from '../../types/canvas';
import { defaultApiUrl } from '../../types/config';

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
  /** Callback function called after successful upload */
  onUploadSuccess?: (data: UploadResponse) => void;
  /** Callback function called after upload error */
  onUploadError?: (error: string) => void;
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

// ... existing code ...

export function useFileUpload({
  chatModelId, 
  chatInstanceId, 
  user, 
  config,
  onUploadSuccess,
  onUploadError
}: UseFileUploadProps) {
  console.log(`[FILE_UPLOAD] Hook initialized for chatModelId: ${chatModelId}, chatInstanceId: ${chatInstanceId}`);
  
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalApiToken = config?.apiToken || "";

  const uploadFile = async (file: File): Promise<UploadResponse> => {
    console.log(`[FILE_UPLOAD] uploadFile called for file: ${file.name} (${file.size} bytes)`);
    console.log(`[FILE_UPLOAD] Upload URL: ${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`);
    
    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const headers: Record<string, string> = {
        appToken: finalApiToken,
      };

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers["Authorization"] = `Bearer ${user.token}`;
        console.log(`[FILE_UPLOAD] Using user authentication`);
      } else {
        console.log(`[FILE_UPLOAD] No user token, using app token only`);
      }

      console.log(`[FILE_UPLOAD] Making POST request to upload file`);
      const response = await fetch(
        `${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`,
        {
          method: 'POST',
          body: formData,
          headers: headers,
        }
      );

      console.log(`[FILE_UPLOAD] Response status: ${response.status}`);

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
        console.error(`[FILE_UPLOAD] Upload failed:`, errorMessage);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log(`[FILE_UPLOAD] Upload successful:`, data);
      
      // Call success callback if provided
      if (onUploadSuccess) {
        console.log(`[FILE_UPLOAD] Calling onUploadSuccess callback`);
        onUploadSuccess(data);
      } else {
        console.log(`[FILE_UPLOAD] No onUploadSuccess callback provided`);
      }
      
      return data;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to upload file';
      console.error(`[FILE_UPLOAD] Upload error:`, errorMessage);
      setError(errorMessage);
      
      // Call error callback if provided
      if (onUploadError) {
        console.log(`[FILE_UPLOAD] Calling onUploadError callback`);
        onUploadError(errorMessage);
      } else {
        console.log(`[FILE_UPLOAD] No onUploadError callback provided`);
      }
      
      return {
        success: false,
        error: errorMessage
      };
    } finally {
      console.log(`[FILE_UPLOAD] Setting isUploading to false`);
      setIsUploading(false);
    }
  };

  const restoreCanvas = async (canvasId: string, content: string): Promise<UploadResponse> => {
    console.log(`[FILE_UPLOAD] restoreCanvas called for canvasId: ${canvasId}`);
    console.log(`[FILE_UPLOAD] Restore URL: ${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva/${canvasId}`);
    
    setIsUploading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        appToken: finalApiToken,
      };

      if (user?.token) {
        headers["x-use-chatbot-auth"] = "true";
        headers["Authorization"] = `Bearer ${user.token}`;
        console.log(`[FILE_UPLOAD] Using user authentication for restore`);
      } else {
        console.log(`[FILE_UPLOAD] No user token, using app token only for restore`);
      }

      console.log(`[FILE_UPLOAD] Making POST request to restore canvas content`);
      const response = await fetch(
        `${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva/${canvasId}`,
        {
          method: 'POST',
          body: JSON.stringify({ content }),
          headers: headers,
        }
      );

      console.log(`[FILE_UPLOAD] Restore response status: ${response.status}`);

      if (!response.ok) {
        let errorMessage = `Canvas restore failed with status ${response.status}`;
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
        console.error(`[FILE_UPLOAD] Canvas restore failed:`, errorMessage);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log(`[FILE_UPLOAD] Canvas restore successful:`, data);
      
      // Call success callback if provided
      if (onUploadSuccess) {
        console.log(`[FILE_UPLOAD] Calling onUploadSuccess callback for restore`);
        onUploadSuccess(data);
      } else {
        console.log(`[FILE_UPLOAD] No onUploadSuccess callback provided for restore`);
      }
      
      return data;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to restore canvas';
      console.error(`[FILE_UPLOAD] Canvas restore error:`, errorMessage);
      setError(errorMessage);
      
      // Call error callback if provided
      if (onUploadError) {
        console.log(`[FILE_UPLOAD] Calling onUploadError callback for restore`);
        onUploadError(errorMessage);
      } else {
        console.log(`[FILE_UPLOAD] No onUploadError callback provided for restore`);
      }
      
      return {
        success: false,
        error: errorMessage
      };
    } finally {
      console.log(`[FILE_UPLOAD] Setting isUploading to false after restore`);
      setIsUploading(false);
    }
  };

  console.log(`[FILE_UPLOAD] Hook render complete. isUploading: ${isUploading}, error: ${error}`);

  return {
    // File operations
    uploadFile,
    restoreCanvas,
        
    // State
    isUploading,
    error,
    
    // Utility methods
    clearError: () => setError(null)
  };
}
