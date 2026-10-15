// Разбор книги Excel в отдельном процессе с собственным пределом памяти (запускается из
// services/imports.js): подложный файл может исчерпать память или время только этого процесса,
// а сервер продолжает работать и отвечает понятной ошибкой.
import { readWorkbook, XlsxError } from '../xlsx/reader.js';
import { analyzeWorkbook } from './analyze.js';

process.once('message', ({ buffer, includeHidden }) => {
  let reply;
  try {
    const wb = readWorkbook(Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    reply = { analysis: analyzeWorkbook(wb, { includeHidden }) };
  } catch (e) {
    reply = { error: e instanceof XlsxError ? e.message : 'Не удалось прочитать файл Excel. Убедитесь, что это файл .xlsx.' };
  }
  process.send(reply, () => process.exit(0));
});
