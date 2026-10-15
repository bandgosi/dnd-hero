// Кадрирование фотографии в браузере. Исходный файл сохраняется без изменений,
// кадр (до 900×900) и миниатюра (240×240) готовятся здесь и отправляются вместе с ним.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Loader2 } from 'lucide-react';
import { Modal } from './ui.jsx';

const VIEW = 300;
const MAX_MB = 25;
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

async function decode(source) {
  try {
    return await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    // Запасной путь через <img>.
    const url = URL.createObjectURL(source);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось подготовить изображение'))), type, quality));
}

export function checkImageFile(file) {
  if (!file) return 'Файл не выбран';
  if (file.size > MAX_MB * 1024 * 1024) return `Файл больше ${MAX_MB} МБ`;
  if (file.type && !ACCEPT.split(',').includes(file.type)) {
    if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) return 'Формат HEIC не поддерживается. Сохраните фото как JPEG (на iPhone: Настройки → Камера → Форматы → «Наиболее совместимый»).';
    return 'Поддерживаются изображения JPEG, PNG, WebP и GIF';
  }
  return null;
}

// file — новый файл; либо originalUrl — исходник уже сохранённой фотографии.
export function PhotoCropper({ file, originalUrl, initialCrop, title = 'Кадрирование фотографии', onCancel, onDone, saving }) {
  const canvasRef = useRef(null);
  const [img, setImg] = useState(null);
  const [error, setError] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let src = file;
        if (!src && originalUrl) {
          const r = await fetch(originalUrl, { credentials: 'same-origin' });
          if (!r.ok) throw new Error();
          src = await r.blob();
        }
        const bmp = await decode(src);
        if (cancelled) return;
        setImg(bmp);
        const w = bmp.width;
        const h = bmp.height;
        const base = VIEW / Math.min(w, h);
        if (initialCrop && initialCrop.w > 0) {
          const z = Math.min(8, Math.max(1, Math.min(w, h) / initialCrop.w));
          const s = base * z;
          setZoom(z);
          setOffset({ x: -initialCrop.x * s, y: -initialCrop.y * s });
        } else {
          setOffset({ x: (VIEW - w * base) / 2, y: (VIEW - h * base) / 2 });
        }
      } catch {
        if (!cancelled) setError('Не удалось открыть изображение. Поддерживаются JPEG, PNG, WebP и GIF.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, originalUrl, initialCrop]);

  const scale = img ? (VIEW / Math.min(img.width, img.height)) * zoom : 1;
  const clamp = useCallback((o, s = scale) => {
    if (!img) return o;
    return {
      x: Math.min(0, Math.max(VIEW - img.width * s, o.x)),
      y: Math.min(0, Math.max(VIEW - img.height * s, o.y)),
    };
  }, [img, scale]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = VIEW * dpr;
    c.height = VIEW * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, VIEW, VIEW);
    const o = clamp(offset);
    ctx.drawImage(img, o.x, o.y, img.width * scale, img.height * scale);
  }, [img, offset, scale, clamp]);

  const setZoomKeep = (z) => {
    const nz = Math.min(8, Math.max(1, z));
    if (!img) return setZoom(nz);
    const s0 = scale;
    const s1 = (VIEW / Math.min(img.width, img.height)) * nz;
    const cx = (VIEW / 2 - offset.x) / s0;
    const cy = (VIEW / 2 - offset.y) / s0;
    setZoom(nz);
    setOffset(clamp({ x: VIEW / 2 - cx * s1, y: VIEW / 2 - cy * s1 }, s1));
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, o: clamp(offset) };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setOffset(clamp({ x: drag.current.o.x + e.clientX - drag.current.x, y: drag.current.o.y + e.clientY - drag.current.y }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKey = (e) => {
    const step = e.shiftKey ? 30 : 8;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      setOffset(clamp({ x: offset.x + moves[e.key][0], y: offset.y + moves[e.key][1] }));
    } else if (e.key === '+' || e.key === '=') setZoomKeep(zoom + 0.2);
    else if (e.key === '-') setZoomKeep(zoom - 0.2);
  };

  const finish = async () => {
    if (!img) return;
    const o = clamp(offset);
    const crop = { x: Math.round(-o.x / scale), y: Math.round(-o.y / scale), w: Math.round(VIEW / scale), h: Math.round(VIEW / scale) };
    const render = async (size, quality) => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, size, size);
      return toBlob(c, 'image/jpeg', quality);
    };
    const displaySize = Math.max(160, Math.min(900, crop.w));
    const display = await render(displaySize, 0.9);
    const thumb = await render(Math.min(240, displaySize), 0.85);
    onDone({ display, thumb, crop });
  };

  return (
    <Modal
      title={title}
      onClose={saving ? undefined : onCancel}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" onClick={finish} disabled={!img || saving}>
            {saving ? <Loader2 size={16} className="spin" /> : null}
            {saving ? 'Сохранение…' : 'Сохранить фото'}
          </button>
        </>
      }
    >
      {error ? (
        <p className="field-error" role="alert">{error}</p>
      ) : (
        <div className="cropper">
          <p className="muted small">Перетащите изображение и измените масштаб. Исходный файл сохранится без изменений.</p>
          <div
            className="cropper-view"
            tabIndex={0}
            role="img"
            aria-label="Область кадрирования: стрелки перемещают, плюс и минус меняют масштаб"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={(e) => setZoomKeep(zoom * (e.deltaY < 0 ? 1.08 : 0.93))}
            onKeyDown={onKey}
          >
            {!img && <Loader2 className="spin" size={24} />}
            <canvas ref={canvasRef} style={{ width: VIEW, height: VIEW }} />
            <span className="cropper-ring" aria-hidden="true" />
          </div>
          <div className="cropper-zoom">
            <button type="button" className="icon-btn" onClick={() => setZoomKeep(zoom - 0.25)} aria-label="Уменьшить">
              <ZoomOut size={18} />
            </button>
            <input type="range" min="1" max="8" step="0.01" value={zoom} onChange={(e) => setZoomKeep(Number(e.target.value))} aria-label="Масштаб" />
            <button type="button" className="icon-btn" onClick={() => setZoomKeep(zoom + 0.25)} aria-label="Увеличить">
              <ZoomIn size={18} />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
