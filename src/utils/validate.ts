/** Browser-safe content-signature validation (no Node APIs). */
import { formatForMime } from '../services/formats.js';

type Signature = { mime: string; bytes: number[]; offset?: number };

const SIGNATURES: Signature[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/bmp', bytes: [0x42, 0x4d] },
  { mime: 'image/tiff', bytes: [0x49, 0x49, 0x2a, 0x00] },
  { mime: 'image/tiff', bytes: [0x4d, 0x4d, 0x00, 0x2a] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const DOCX_ZIP = [0x50, 0x4b, 0x03, 0x04];
const HTMLISH = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45];

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

/** Verify that file content matches the declared MIME type. Throws on mismatch. */
export function verifyFileContent(bytes: Uint8Array, mime: string, name: string): void {
  const m = mime.toLowerCase();
  for (const sig of SIGNATURES) {
    if (sig.mime === m && startsWith(bytes, sig.bytes, sig.offset ?? 0)) return;
  }
  if (
    m === 'image/webp' &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return;
  }
  if ((m.includes('wordprocessingml') || m.includes('presentationml')) && startsWith(bytes, DOCX_ZIP)) return;
  if ((m === 'application/msword' || m === 'application/vnd.ms-powerpoint') && (startsWith(bytes, OLE2) || startsWith(bytes, HTMLISH))) return;

  const label = formatForMime(mime)?.label ?? 'file';
  throw new Error(`“${name}” is not a valid ${label} file. Choose another file.`);
}
