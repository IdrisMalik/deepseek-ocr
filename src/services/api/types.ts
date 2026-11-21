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

/** Latest extraction attempt; independent of whether a result is committed. */
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
  /**
   * Latest extraction attempt. A failed or cancelled attempt can still have a
   * committed `result` from an earlier success.
   */
  status: FileStatus;
  /** Native purpose that produced `result`, or null before extraction. */
  purpose: OcrPurpose | null;
  /** Error from the latest attempt, cleared when a new attempt starts. */
  error: string | null;
  /** Last successful extraction; replaced only when a new extraction succeeds. */
  result: FileOcrResult | null;
  editedText: string | null;
};
