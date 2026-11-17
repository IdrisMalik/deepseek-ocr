/**
 * Dynamic interface strings. Static markup (headings, labels, hints) lives in
 * `src/index.html`; this catalog covers every string the app writes at runtime.
 * Only English is bundled in v0.1.0.
 */
export const en = {
  // File cards
  addMoreFiles: 'Add more files',
  rotate: 'Rotate 90°',
  rotateLabel: 'Rotate {name} 90 degrees',
  removeLabel: 'Remove {name}',
  failed: 'Failed',
  retry: 'Retry',
  retryLabel: 'Retry {name}',
  cancelled: 'Cancelled',
  textExtracted: 'Text extracted',
  processingAria: 'Processing',
  fileOne: '1 file',
  fileMany: '{count} files',

  // Batch lifecycle
  extractText: 'Extract text',
  maxFiles: 'You can add up to {count} files.',
  couldNotVerify: 'Could not verify “{name}”. Choose another file.',
  couldNotRead: 'Could not read “{name}”. Choose another file.',
  processing: 'Processing',
  processingLabel: 'Processing…',
  cancelling: 'Cancelling…',
  finished: 'Finished',
  done: 'Done',
  couldNotExtract: 'Could not extract text. Try again.',
  failedOne: '1 file failed.',
  failedMany: '{count} files failed.',
  cancelledToast: 'Cancelled.',
  somethingWrong: 'Something went wrong. Try again.',

  // API key
  addKeyBadge: 'No API key',
  addKeyBadgeTitle: 'Add an API key to extract text.',
  addKeyToast: 'API key required.',
  noKeyStatus: 'No API key saved. Add one to extract text.',
  demoKeyStatus: 'No API key needed in demo mode.',
  savedKeyStatus: 'API key saved.',
  enterKeyFirst: 'Enter an API key.',
  verifying: 'Verifying…',
  keyVerified: 'API key verified and saved.',
  keySavedToast: 'API key saved.',
  invalidKey: 'Invalid API key. Check it and try again.',
  unknownError: 'Unknown error.',
  keyRemoved: 'API key removed.',
  keyRemovedBatchCancelled: 'API key removed. Running batch cancelled.',

  // Mode badge
  demoBadge: 'Demo mode',
  demoBadgeTitle: 'Simulated results. No API calls or charges.',
  liveBadge: 'Live mode',
  liveBadgeTitle: 'Requests use your saved API key.',

  // Results
  allFiles: 'All files',
  copied: 'Copied.',
  copyFailed: 'Could not copy. Select the text and copy it manually.',
  emptyStats: '0 characters · 0 words · 0 lines',
  ocrAllResults: 'ocr-all-results',
  ocrOutput: 'ocr-output',
} as const;
