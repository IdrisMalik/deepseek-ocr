/**
 * Dynamic interface strings. Static markup (headings, labels, hints) lives in
 * `src/index.html`. Only English is bundled.
 */
export const en = {
  // File cards
  addMoreFiles: 'Add more files',
  rotate: 'Rotate 90°',
  rotateLabel: 'Rotate {name} 90 degrees',
  removeLabel: 'Remove {name}',
  failed: 'Could not extract',
  retry: 'Retry',
  retryLabel: 'Retry {name}',
  cancelled: 'Cancelled',
  textExtracted: 'Text extracted',
  processingAria: 'Extracting text',
  fileOne: '1 file',
  fileMany: '{count} files',

  // Batch lifecycle
  extractText: 'Extract text',
  maxFiles: 'You can add up to {count} files.',
  couldNotVerify: 'Could not check “{name}”. Choose another file.',
  processing: 'Extracting…',
  processingLabel: 'Extracting text…',
  cancelling: 'Cancelling…',
  finished: 'Finished',
  done: 'Done',
  couldNotExtract: 'Could not extract text from this file. Try again.',
  failedOne: 'Could not extract text from 1 file.',
  failedMany: 'Could not extract text from {count} files.',
  cancelledToast: 'Cancelled.',
  somethingWrong: 'Something went wrong. Try again.',

  // API key
  addKeyBadge: 'No API key',
  addKeyBadgeTitle: 'Add your DeepSeek API key to extract text.',
  addKeyToast: 'Add your DeepSeek API key first.',
  noKeyStatus: 'No API key saved. Add your DeepSeek API key to extract text.',
  demoKeyStatus: 'No API key needed in demo mode.',
  savedKeyStatus: 'API key saved.',
  enterKeyFirst: 'Enter your DeepSeek API key.',
  verifying: 'Checking…',
  keyVerified: 'API key checked and saved.',
  keySavedToast: 'API key saved.',
  invalidKey: 'That API key is not valid. Check it and try again.',
  unknownError: 'Something went wrong.',
  keyRemoved: 'API key removed.',
  keyRemovedBatchCancelled: 'API key removed. The current batch was cancelled.',

  // API key field
  showKey: 'Show API key',
  hideKey: 'Hide API key',

  // Header status badge
  demoBadge: 'Demo mode',
  demoBadgeTitle: 'Sample results. Nothing is sent to DeepSeek and no charges apply.',
  liveBadge: 'Live mode',
  liveBadgeTitle: 'Requests use your saved DeepSeek API key.',

  // Results
  allFiles: 'All files',
  copied: 'Copied.',
  copyFailed: 'Could not copy. Select the text and copy it manually.',
  emptyStats: '0 characters · 0 words · 0 lines',
  ocrAllResults: 'all-results',
  ocrOutput: 'extracted-text',
} as const;
