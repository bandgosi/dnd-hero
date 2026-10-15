// «Архив»: резервные копии, восстановление, экспорт CSV, место хранения, журнал.
import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Download, Upload, Loader2, FileText, HardDrive, History, ShieldCheck, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import { useData, useUi, reportError } from '../store.jsx';
import { Modal, Notice } from '../components/ui.jsx';
import { ViewHeader } from './TreeView.jsx';
import { fmtDateTime, fmtSize } from '../lib/format.js';

function RestoreDialog({ preview, onClose, onRestored }) {
  const { reload, setSaveState } = useData();
  const ui = useUi();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const c = preview.counts;
  const cur = preview.current;
  const submit = async () => {
    setBusy(true);
    setSaveState({ status: 'saving' });
    try {
      const r = await api.post('/api/backups/restore', { token: preview.token });
      await reload();
      setSaveState({ status: 'saved', at: Date.now() });
      ui.toast(`Данные восстановлены. Прежнее состояние сохранено в копии ${r.backupBefore.name}`);
      onRestored();
      onClose();
    } catch (e) {
      setSaveState({ status: 'error', message: e.message });
      reportError(ui, e);
      setBusy(false);
    }
  };
  const row = (label, a, b) => <tr><td>{label}</td><td>{a}</td><td>{b}</td></tr>;
  return (
    <Modal
      title="Восстановить из резервной копии?"
      onClose={busy ? undefined : onClose}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Отмена</button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={busy || text.trim().toLowerCase() !== 'восстановить'}>
            {busy && <Loader2 size={16} className="spin" />} Восстановить
          </button>
        </>
      }
    >
      <p className="modal-text">Копия от <strong>{fmtDateTime(preview.manifest.createdAt)}</strong>, формат версии {preview.manifest.formatVersion}. Текущие данные будут заменены данными копии. Перед заменой автоматически создаётся резервная копия текущего состояния.</p>
      <table className="table compact">
        <thead><tr><th /><th>Сейчас</th><th>В копии</th></tr></thead>
        <tbody>
          {row('Люди', cur.persons, c.persons)}
          {row('Связи «родитель — ребёнок»', cur.parentChild, c.parentChild)}
          {row('Партнёрства', cur.partnerships, c.partnerships)}
          {row('Фотографии', cur.photos, c.photos)}
          {row('Предположения', cur.hypotheses, c.hypotheses)}
          {row('Источники', cur.sources, c.sources)}
          {row('Импорты', cur.imports, c.imports)}
        </tbody>
      </table>
      {preview.missingPhotos.length > 0 && <Notice tone="warning" title="В копии не хватает файлов фотографий">{preview.missingPhotos.length} файлов отсутствуют — эти фотографии не откроются.</Notice>}
      <label className="field mt-16">
        <span className="field-label">Для подтверждения введите слово «восстановить»</span>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
    </Modal>
  );
}

export function ArchiveView() {
  const { data, save } = useData();
  const ui = useUi();
  const [backups, setBackups] = useState(null);
  const [changes, setChanges] = useState(null);
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [restore, setRestore] = useState(null);
  const fileRef = useRef(null);
  const loadBackups = () => api.get('/api/backups').then((r) => setBackups(r.backups)).catch((e) => ui.toast(e.message, 'error'));
  useEffect(() => {
    loadBackups();
    api.get('/api/changes?limit=60').then((r) => setChanges(r.changes)).catch(() => setChanges([]));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setCreating(true);
    try {
      const r = await save(() => api.post('/api/backups'), { reload: false });
      ui.toast(`Резервная копия создана: ${r.name}`);
      await loadBackups();
    } catch (e) {
      reportError(ui, e);
    } finally {
      setCreating(false);
    }
  };
  const previewFrom = async (fd) => {
    setChecking(true);
    try {
      setRestore(await api.form('/api/backups/restore-preview', fd));
    } catch (e) {
      reportError(ui, e);
    } finally {
      setChecking(false);
    }
  };
  const fromFile = (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file, file.name);
    previewFrom(fd);
  };
  const fromStored = (name) => {
    const fd = new FormData();
    fd.append('name', name);
    previewFrom(fd);
  };
  const m = data.meta;
  return (
    <section className="view view-archive">
      <ViewHeader title="Архив" subtitle="Резервные копии, восстановление и экспорт" />
      <div className="archive-grid">
        <section className="panel-card">
          <h2 className="h2"><DatabaseBackup size={20} /> Резервные копии</h2>
          <p className="muted">Копия — один .zip-файл: люди, связи, предположения, вопросы, источники, история, исходные файлы Excel и все фотографии. Формат версии {m.backupFormatVersion}. Храните копии отдельно от компьютера (флешка, облако по вашему выбору).</p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>{creating ? <Loader2 size={16} className="spin" /> : <DatabaseBackup size={16} />} Создать резервную копию</button>
            <input ref={fileRef} type="file" accept=".zip,application/zip" className="visually-hidden" onChange={(e) => { fromFile(e.target.files?.[0]); e.target.value = ''; }} aria-label="Файл резервной копии" tabIndex={-1} />
            <button type="button" className="btn btn-outline" onClick={() => fileRef.current.click()} disabled={checking}>{checking ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} Восстановить из файла…</button>
          </div>
          <h3 className="subhead mt-16">Сохранённые копии</h3>
          {!backups ? <p className="muted"><Loader2 size={14} className="spin" /> Загрузка…</p> : backups.length === 0 ? <p className="muted">Копий пока нет. Автоматическая копия создаётся раз в сутки, когда в архиве есть данные.</p> : (
            <ul className="backup-list">
              {backups.map((b) => (
                <li key={b.name}>
                  <div className="grow">
                    <span className="break">{b.name}</span>
                    <span className="muted small block">{fmtDateTime(b.modifiedAt)} · {fmtSize(b.size)}{b.name.includes('-auto') ? ' · автоматическая' : b.name.includes('before-') ? ' · перед изменением' : ''}</span>
                  </div>
                  <a className="btn btn-small btn-ghost" href={`/api/backups/${encodeURIComponent(b.name)}/download`} download><Download size={14} /> Скачать</a>
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => fromStored(b.name)}><RotateCcw size={14} /> Восстановить…</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel-card">
          <h2 className="h2"><FileText size={20} /> Экспорт в CSV</h2>
          <p className="muted">Таблицы для Excel (UTF-8, разделитель «;»). Неизвестные значения — пустые ячейки, точность дат — отдельные столбцы, исходные строки Excel — без изменений.</p>
          <div className="btn-row">
            <a className="btn btn-outline" href="/api/export/persons.csv" download><Download size={16} /> Люди (CSV)</a>
            <a className="btn btn-outline" href="/api/export/relations.csv" download><Download size={16} /> Связи (CSV)</a>
          </div>
          <h2 className="h2 mt-24"><HardDrive size={20} /> Где хранятся данные</h2>
          <dl className="info-list compact">
            <div className="info-row"><dt>База данных</dt><dd className="break"><code>{m.storage.dbFile}</code></dd></div>
            <div className="info-row"><dt>Фотографии</dt><dd className="break"><code>{m.storage.photosDir}</code></dd></div>
            <div className="info-row"><dt>Копии</dt><dd className="break"><code>{m.storage.backupsDir}</code></dd></div>
            <div className="info-row"><dt>Файлы импорта</dt><dd className="break"><code>{m.storage.importsDir}</code></dd></div>
          </dl>
          <Notice tone="info" icon={<ShieldCheck size={20} />} title="Приватность">
            Данные хранятся только на этом компьютере и никуда не отправляются. {m.authEnabled ? 'Вход защищён паролем.' : 'Сервер доступен только с этого компьютера; для доступа из сети нужен пароль (см. инструкцию).'}
          </Notice>
        </section>
      </div>

      <section className="panel-card mt-16">
        <h2 className="h2"><History size={20} /> Журнал изменений</h2>
        {!changes ? <p className="muted">Загрузка…</p> : changes.length === 0 ? <p className="muted">Изменений пока нет.</p> : (
          <ol className="history compact">
            {changes.map((c) => (
              <li key={c.id}><span className="history-dot" aria-hidden="true" /><div><p className="history-summary">{c.summary}</p><p className="muted small">{fmtDateTime(c.at)} · {{ user: 'вы', import: 'импорт', system: 'система' }[c.actor]}</p></div></li>
            ))}
          </ol>
        )}
      </section>
      {restore && <RestoreDialog preview={restore} onClose={() => setRestore(null)} onRestored={loadBackups} />}
    </section>
  );
}
