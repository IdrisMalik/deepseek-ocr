/** Browser-safe content-signature validation (no Node APIs). */
import { formatForMime } from '../services/formats.js';

type Signature = { mime: string; bytes: number[] };

const SIGNATURES: Signature[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
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

/** Read the first local ZIP entry name without loading the whole archive. */
function firstZipEntryName(bytes: Uint8Array): string | null {
  if (!startsWith(bytes, DOCX_ZIP) || bytes.length < 30) return null;
  const nameLength = bytes[26] | (bytes[27] << 8);
  if (nameLength === 0 || 30 + nameLength > bytes.length) return null;
  let name = '';
  for (let i = 0; i < nameLength; i += 1) name += String.fromCharCode(bytes[30 + i]);
  return name;
}

function isOfficeZip(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, DOCX_ZIP)) return false;
  const first = firstZipEntryName(bytes);
  // If the first entry is not readable, defer to the API's content parser.
  if (first === null) return true;
  return (
    first === '[Content_Types].xml' ||
    first.startsWith('_rels/') ||
    first.startsWith('word/') ||
    first.startsWith('ppt/')
  );
}

function isBmp(bytes: Uint8Array, fileSize?: number): boolean {
  if (!startsWith(bytes, [0x42, 0x4d]) || bytes.length < 14) return false;
  const reserved = bytes[6] | bytes[7] | bytes[8] | bytes[9];
  const pixelOffset = bytes[10] | (bytes[11] << 8) | (bytes[12] << 16) | (bytes[13] << 24);
  return reserved === 0 && pixelOffset >= 14 && (fileSize === undefined || pixelOffset <= fileSize);
}

/** Verify that file content matches the declared MIME type. Throws on mismatch. */
export function verifyFileContent(
  bytes: Uint8Array,
  mime: string,
  name: string,
  fileSize?: number
): void {
  const m = mime.toLowerCase();
  for (const sig of SIGNATURES) {
    if (sig.mime === m && startsWith(bytes, sig.bytes)) return;
  }
  if (
    m === 'image/webp' &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return;
  }
  if (m === 'image/bmp' && isBmp(bytes, fileSize)) return;
  if ((m.includes('wordprocessingml') || m.includes('presentationml')) && isOfficeZip(bytes)) {
    return;
  }
  if (
    (m === 'application/msword' || m === 'application/vnd.ms-powerpoint') &&
    (startsWith(bytes, OLE2) || startsWith(bytes, HTMLISH))
  ) {
    return;
  }

  const label = formatForMime(mime)?.label ?? 'file';
  throw new Error(`“${name}” is not a valid ${label} file. Choose another file.`);
}
