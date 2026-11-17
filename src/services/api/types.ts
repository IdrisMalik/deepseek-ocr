export type OcrPurpose = 'text_recognition' | 'rich_layout_recognition';

export type PageResult = {
  index: number;
  text: string;
  finishReason: 'stop' | 'length' | 'unknown';
};

export type FileOcrError = {
  message: string;
  code: string;
  retryable: boolean;
};

export type FileOcrResult = {
  id?: string;
  name: string;
  pages: PageResult[];
  inputTokens?: number;
  outputTokens?: number;
  error?: FileOcrError;
};

export type OcrResponse = {
  mode: 'live' | 'mock';
  results: FileOcrResult[];
};

export type ApiErrorPayload = {
  error?: { message?: string; code?: string; type?: string };
};

export type FileStatus = 'ready' | 'processing' | 'done' | 'error' | 'cancelled';

/** A queued input file — an image or a document (PDF/Word/PowerPoint). */
export type FileItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  blob: Blob;
  previewUrl: string;
  rotation: number;
  status: FileStatus;
  error: string | null;
  result: FileOcrResult | null;
  editedText: string | null;
};
