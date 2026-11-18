export type OcrPurpose = 'text_recognition' | 'rich_layout_recognition';

export type PageResult = {
  index: number;
  text: string;
  finishReason: 'stop' | 'length' | 'unknown';
};

export type FileOcrResult = {
  pages: PageResult[];
};

export type ApiErrorPayload = {
  error?: { message?: string; code?: string; type?: string };
};

export type FileStatus = 'ready' | 'processing' | 'done' | 'error' | 'cancelled';

/** An input file with its preview and extraction state. */
export type FileItem = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  blob: Blob;
  previewUrl: string;
  rotation: number;
  status: FileStatus;
  /** Native purpose that produced `result`, or null before extraction. */
  purpose: OcrPurpose | null;
  error: string | null;
  result: FileOcrResult | null;
  editedText: string | null;
};
