import { useState } from 'react';
import { CanvasPurpose, UploadResponse } from '../../types/canvas';
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

/** Un cœur qui ne connaît pas encore la route v1 : on repasse par l'ancienne. */
const LEGACY_FALLBACK_STATUSES = [401, 403, 404, 405];

export function useFileUpload({
  chatModelId,
  chatInstanceId,
  user,
  config,
  onUploadSuccess,
  onUploadError
}: UseFileUploadProps) {

  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalApiUrl = config?.apiUrl || defaultApiUrl;
  const finalApiToken = config?.apiToken || "";

  const legacyUrl = `${finalApiUrl}/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`;
  const v1Url = `${finalApiUrl}/api/v1/me/conversations/${encodeURIComponent(chatInstanceId)}/attachments`;

  const buildForm = (file: File, purpose: CanvasPurpose): FormData => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', purpose);
    return formData;
  };

  /**
   * La route v1 rattache le fichier à son propriétaire ; elle exige donc une
   * personne identifiée. Un visiteur anonyme du widget n'en a pas, et garde la
   * route publique — qui reste servie par la même logique côté cœur.
   */
  const uploadViaV1 = async (file: File, purpose: CanvasPurpose): Promise<Response | null> => {
    if (!user?.token) return null;

    const response = await fetch(v1Url, {
      method: 'POST',
      body: buildForm(file, purpose),
      headers: {
        Authorization: `Bearer ${user.token}`,
        'x-chat-model-id': chatModelId,
      },
    });

    return LEGACY_FALLBACK_STATUSES.includes(response.status) ? null : response;
  };

  const uploadViaLegacy = async (file: File, purpose: CanvasPurpose): Promise<Response> => {
    const headers: Record<string, string> = {
      appToken: finalApiToken,
    };

    if (user?.token) {
      headers["x-use-chatbot-auth"] = "true";
      headers["Authorization"] = `Bearer ${user.token}`;
    }

    return fetch(legacyUrl, {
      method: 'POST',
      body: buildForm(file, purpose),
      headers,
    });
  };

  const uploadFile = async (
    file: File,
    purpose: CanvasPurpose = 'ANALYSIS'
  ): Promise<UploadResponse> => {

    setIsUploading(true);
    setError(null);

    try {
      const response = (await uploadViaV1(file, purpose)) ?? (await uploadViaLegacy(file, purpose));

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = await response.json();

      // Call success callback if provided
      if (onUploadSuccess) {
        onUploadSuccess(data);
      }

      return data;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to upload file';
      setError(errorMessage);

      // Call error callback if provided
      if (onUploadError) {
        onUploadError(errorMessage);
      }

      return {
        success: false,
        error: errorMessage
      };
    } finally {
      setIsUploading(false);
    }
  };


  return {
    // File operations
    uploadFile,

    // State
    isUploading,
    error,

    // Utility methods
    clearError: () => setError(null)
  };
}

/** Le message du serveur quand il y en a un, son statut sinon. */
async function readError(response: Response): Promise<string> {
  try {
    const body = await response.clone().json();
    if (body?.error || body?.message) return body.error || body.message;
  } catch {
    try {
      const text = await response.text();
      if (text) return text;
    } catch {
      // Ni JSON ni texte : le statut est tout ce qu'on peut dire.
    }
  }
  return `Upload failed with status ${response.status}`;
}
