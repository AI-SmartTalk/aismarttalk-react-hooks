import { useState } from 'react';
import { CanvasFileType } from './types';

interface CanvasMetadata {
  originalName: string;
  size: number;
  mimeType: string;
}

interface Canvas {
  id: string;
  title: string;
  status: string;
  fileType: CanvasFileType;
  metadata: CanvasMetadata;
  chunks: CanvasChunk[];
}

interface CanvasChunk {
  id: string;
  content: string;
  lineStart: number;
  lineEnd: number;
  canvasId: string;
}

interface UploadResponse {
  success: boolean;
  canvas?: Canvas;
  error?: string;
}

interface FetchCanvasResponse {
  success: boolean;
  canvases: Canvas[];
  error?: string;
}

export function useFileUpload(chatModelId: string, chatInstanceId: string) {
  const [isUploading, setIsUploading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = async (file: File): Promise<UploadResponse> => {
    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(
        `/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`,
        {
          method: 'POST',
          body: formData,
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload file');
      }

      return data;
    } catch (err: any) {
      setError(err.message);
      return {
        success: false,
        error: err.message
      };
    } finally {
      setIsUploading(false);
    }
  };

  const fetchCanvases = async (): Promise<FetchCanvasResponse> => {
    setIsFetching(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/public/chatModel/${chatModelId}/chatInstance/${chatInstanceId}/canva`,
        {
          method: 'GET',
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch canvases');
      }

      return data;
    } catch (err: any) {
      setError(err.message);
      return {
        success: false,
        canvases: [],
        error: err.message
      };
    } finally {
      setIsFetching(false);
    }
  };

  return {
    uploadFile,
    fetchCanvases,
    isUploading,
    isFetching,
    error
  };
}
