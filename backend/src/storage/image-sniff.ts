export interface ImageKind {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  ext: 'jpg' | 'png' | 'webp';
}

export const ALLOWED_PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Identifies the image from its first bytes ("magic numbers"). The browser's
// declared type and the file name can both be faked, so neither is trusted.
export function sniffImage(buf: Buffer | Uint8Array | null | undefined): ImageKind | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => buf[i] === b)) {
    return { mime: 'image/png', ext: 'png' };
  }
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(buf.subarray(from, to)));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}
