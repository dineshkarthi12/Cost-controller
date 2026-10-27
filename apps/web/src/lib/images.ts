/**
 * Hosting platforms cap request bodies (Vercel: 4.5 MB), and phone photos often exceed that.
 * Large JPEG/PNG/WebP photos are re-encoded in the browser to a smaller JPEG before upload.
 * Small images and non-images are returned unchanged. Location is captured separately by the
 * browser, so no metadata the app relies on is lost.
 */
export const UPLOAD_SAFE_BYTES = 3.5 * 1024 * 1024;

const RESIZABLE = ['image/jpeg', 'image/png', 'image/webp'];

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function shrinkImage(file: File, maxBytes = UPLOAD_SAFE_BYTES): Promise<File> {
  if (file.size <= maxBytes || !RESIZABLE.includes(file.type) || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    for (const [side, q] of [[2560, 0.85], [1920, 0.8], [1600, 0.72]] as const) {
      const blob = await encode(bitmap, side, q);
      if (blob && blob.size <= maxBytes) {
        bitmap.close();
        return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
      }
    }
    bitmap.close();
  } catch {
    /* fall through: upload the original and let the server explain any size limit */
  }
  return file;
}
