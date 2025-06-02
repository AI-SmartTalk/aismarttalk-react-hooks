export type CanvasFileType = 
  | 'TEXT'
  | 'MARKDOWN'
  | 'PDF'
  | 'DOC'
  | 'DOCX'
  | 'CSV'
  | 'XLSX'
  | 'XLS'
  | 'JSON'
  | 'YAML'
  | 'XML'
  | 'HTML'
  | 'OTHER';

export interface CanvasMetadata {
  originalName: string;
  size: number;
  mimeType: string;
}

export interface CanvasChunk {
  id: string;
  content: string;
  lineStart: number;
  lineEnd: number;
  canvasId: string;
}

export interface Canvas {
  id: string;
  title: string;
  status: string;
  fileType: CanvasFileType;
  metadata: CanvasMetadata;
  chunks: CanvasChunk[];
} 

export interface UploadResponse {
  success: boolean;
  canvas?: Canvas;
  error?: string;
}

export interface FetchCanvasResponse {
  success: boolean;
  canvases: Canvas[];
  error?: string;
}