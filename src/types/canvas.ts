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
  | 'IMAGE'
  | 'OTHER';

/**
 * Ce que l'utilisateur veut faire du fichier déposé.
 *
 * `ANALYSIS` — interrogeable, pas modifiable.
 * `EDIT` — interrogeable et réécrit sur instruction (le canvas).
 * `KNOWLEDGE` — versé au corpus permanent de l'assistant.
 */
export type CanvasPurpose = 'ANALYSIS' | 'EDIT' | 'KNOWLEDGE';

/** Où en est l'indexation, telle que le cœur la nomme. */
export type CanvasStatus = 'PROCESSING' | 'VECTORIZED' | 'FAILED' | 'DELETED';

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
  status: CanvasStatus | string;
  fileType: CanvasFileType;
  /** Déclarée au dépôt ; `ANALYSIS` pour les canvas créés avant qu'elle existe. */
  purpose?: CanvasPurpose;
  /** Renseigné quand `status === 'FAILED'`. */
  failureReason?: string | null;
  /** L'original sur le CDN, quand il a pu y être déposé. */
  downloadUrl?: string | null;
  createdAt?: string;
  size?: number | null;
  metadata?: CanvasMetadata;
  chunks?: CanvasChunk[];
}

export interface UploadResponse {
  success: boolean;
  canvas?: Canvas;
  error?: string;
  /** Le motif du refus, exploitable sans lire le message : `FILE_TOO_LARGE`… */
  code?: string;
}

export interface FetchCanvasResponse {
  success: boolean;
  canvases: Canvas[];
  error?: string;
}

/** Ce que l'installation accepte en pièce jointe. */
export interface CanvasCapabilities {
  extensions: string[];
  maxBytes: number;
  visionEnabled: boolean;
}
