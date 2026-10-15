// Распаковка ZIP в память с подсчётом фактически распакованных байт
// (заявленным в архиве размерам не доверяем — защита от «zip-бомб»).
import { Unzip, UnzipInflate } from 'fflate';

export class ZipLimitError extends Error {}

export function safeUnzipSync(buffer, { want = () => true, maxEntryBytes, maxTotalBytes, maxEntries = 5000 }) {
  const out = {};
  const names = [];
  let total = 0;
  let error = null;
  const uz = new Unzip((file) => {
    if (error) return;
    names.push(file.name);
    if (names.length > maxEntries) {
      error = new ZipLimitError('В файле слишком много внутренних элементов');
      return;
    }
    if (!want(file.name)) return;
    const chunks = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (error) return;
      if (err) {
        error = err;
        return;
      }
      size += chunk.length;
      total += chunk.length;
      if (size > maxEntryBytes || total > maxTotalBytes) {
        error = new ZipLimitError('Файл содержит слишком большие внутренние элементы');
        return;
      }
      chunks.push(chunk);
      if (final) {
        const buf = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) {
          buf.set(c, o);
          o += c.length;
        }
        out[file.name] = buf;
      }
    };
    file.start();
  });
  uz.register(UnzipInflate);
  const data = new Uint8Array(buffer);
  // Небольшими порциями: распакованный кусок одной порции ограничен (~16 МБ даже при максимальном сжатии).
  const STEP = 16 * 1024;
  for (let i = 0; i < data.length && !error; i += STEP) uz.push(data.subarray(i, i + STEP), i + STEP >= data.length);
  if (error) throw error;
  return { files: out, names };
}
