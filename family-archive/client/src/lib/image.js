// Подготовка фотографии в браузере: уменьшение до заданного размера и сжатие в JPEG.
// Перекодирование «запекает» поворот из EXIF и убирает метаданные (в том числе GPS).

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть изображение. Поддерживаются JPEG, PNG, WebP и GIF.'));
    };
    img.decoding = 'async';
    img.src = url;
  });
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось подготовить изображение'))), type, quality));
}

// Возвращает { blob, width, height, originalSize, size, compressed }.
export async function compressImage(file, { maxSide = 2048, quality = 0.85 } = {}) {
  if (!maxSide) return { blob: file, width: null, height: null, originalSize: file.size, size: file.size, compressed: false };
  let source;
  let width;
  let height;
  let cleanup = () => {};
  try {
    const { img, url } = await loadImage(file);
    source = img;
    width = img.naturalWidth;
    height = img.naturalHeight;
    cleanup = () => URL.revokeObjectURL(url);
  } catch (e) {
    // Запасной путь для браузеров, где <img> не справился.
    try {
      source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      width = source.width;
      height = source.height;
      cleanup = () => source.close?.();
    } catch {
      throw e;
    }
  }
  try {
    if (!width || !height) throw new Error('Не удалось определить размер изображения');
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    const blob = await toBlob(canvas, 'image/jpeg', quality);
    canvas.width = 0;
    canvas.height = 0;
    return { blob, width: w, height: h, originalSize: file.size, size: blob.size, compressed: true };
  } finally {
    cleanup();
  }
}
