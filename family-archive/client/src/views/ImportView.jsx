// «Импорт из Excel»: предпросмотр, сверка версий, сохранение и откат.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Info, XCircle, Loader2, Download, RotateCcw, Network, HelpCircle } from 'lucide-react';
import { api } from '../api.js';
import { useData, useUi, reportError } from '../store.jsx';
import { Notice, Modal, EmptyState, Segmented, Avatar } from '../components/ui.jsx';
import { PersonPicker } from '../components/fields.jsx';
import { ViewHeader } from './TreeView.jsx';
import { fmtDateTime, fmtSize, showSpaces, countText } from '../lib/format.js';

const LEVEL_ICON = {
  ok: <CheckCircle2 size={18} className="ic-ok" />,
  info: <Info size={18} className="ic-info" />,
  warn: <AlertTriangle size={18} className="ic-warn" />,
  error: <XCircle size={18} className="ic-error" />,
};

const DIFF_LABELS = {
  unchanged: 'Без изменений',
  changed: 'Изменён текст',
  new: 'Новая запись',
  moved: 'Перемещена',
  removed: 'Отсутствует в новой версии',
  person_deleted: 'Человек был удалён вручную',
};
const ACTION_LABELS = {
  create: 'Создать нового человека',
  link: 'Связать с существующим',
  skip: 'Не импортировать',
  update_name: 'Обновить имя по файлу',
  keep: 'Оставить мои правки',
};

function SheetGrid({ geometry, records }) {
  const recByCell = new Map(records.map((r) => [r.cell, r]));
  const mergeAt = new Map();
  for (const m of geometry.merges) {
    for (let r = m.top; r <= m.bottom; r++) for (let c = m.left; c <= m.right; c++) mergeAt.set(`${r}:${c}`, m);
  }
  const borderAt = new Map(geometry.borderedCells.map((b) => [`${b.row}:${b.col}`, b.border]));
  const line = '1.5px solid var(--sheet-line)';
  return (
    <div className="sheet-wrap" role="region" aria-label="Схема листа" tabIndex={0}>
      <table className="sheet">
        <thead>
          <tr>
            <th aria-hidden="true" />
            {geometry.columns.map((c) => <th key={c.index} scope="col">{c.letter}</th>)}
          </tr>
        </thead>
        <tbody>
          {geometry.rows.map((row) => (
            <tr key={row.index} className={row.hasRecords ? '' : 'is-empty-row'}>
              <th scope="row">{row.index}</th>
              {geometry.columns.map((col) => {
                const m = mergeAt.get(`${row.index}:${col.index}`);
                if (m && !(m.top === row.index && m.left === col.index)) return null;
                const ref = `${col.letter}${row.index}`;
                const rec = recByCell.get(ref);
                const b = borderAt.get(`${row.index}:${col.index}`) || {};
                // Для объединения: границы берутся с краёв диапазона.
                let style = { borderTop: b.top ? line : undefined, borderLeft: b.left ? line : undefined, borderBottom: b.bottom ? line : undefined, borderRight: b.right ? line : undefined };
                if (m) {
                  const last = borderAt.get(`${m.bottom}:${m.right}`) || {};
                  style = { ...style, borderRight: last.right ? line : undefined, borderBottom: last.bottom ? line : undefined };
                }
                return (
                  <td key={col.index} colSpan={m ? m.right - m.left + 1 : undefined} rowSpan={m ? m.bottom - m.top + 1 : undefined} style={style} className={rec ? 'has-record' : ''} title={rec ? `${ref}${m ? ` (${m.ref})` : ''}: «${rec.raw}»` : ref}>
                    {rec && (
                      <>
                        <span className="sheet-cell-ref">{m ? m.ref : ref}</span>
                        <span className="sheet-value">{showSpaces(rec.raw)}</span>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small mt-8">Символ ␣ показывает пробелы в конце исходной строки. Толстые линии — границы ячеек из файла.</p>
    </div>
  );
}

function RecordsTable({ preview, decisions, setDecision }) {
  const diffByKey = new Map((preview.diff?.entries || []).map((e) => [e.key, e]));
  const [linkFor, setLinkFor] = useState(null);
  const { index } = useData();
  return (
    <div className="table-wrap">
      <table className="table records-table">
        <thead>
          <tr>
            <th>Ячейка</th>
            <th>Исходный текст</th>
            <th>Отображаемое имя</th>
            <th>Фамилия</th>
            <th>Имя</th>
            <th>Отчество</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {preview.records.map((r) => {
            const d = decisions[r.key] || {};
            const f = { display_name: r.text, surname: r.parse.surname || '', given_name: r.parse.given_name || '', patronymic: r.parse.patronymic || '', ...(d.fields || {}) };
            const entry = diffByKey.get(r.key);
            const actions = entry ? entry.actions : ['create', 'link', 'skip'];
            const action = d.action || entry?.defaultAction || 'create';
            const editable = action === 'create';
            const setField = (k) => (e) => setDecision(r.key, { ...d, fields: { ...f, [k]: e.target.value } });
            return (
              <tr key={r.key}>
                <td><strong>{r.cell}</strong>{r.mergedRange && <span className="muted small block">{r.mergedRange}</span>}</td>
                <td><code className="raw-text">{showSpaces(r.raw)}</code>{r.parse.confidence === 'unparsed' && <span className="muted small block">{r.parse.note}</span>}</td>
                <td><input className="input input-small" value={f.display_name} onChange={setField('display_name')} disabled={!editable} aria-label={`${r.cell}: отображаемое имя`} /></td>
                <td><input className="input input-small" value={f.surname} onChange={setField('surname')} disabled={!editable} placeholder="—" aria-label={`${r.cell}: фамилия`} /></td>
                <td><input className="input input-small" value={f.given_name} onChange={setField('given_name')} disabled={!editable} placeholder="—" aria-label={`${r.cell}: имя`} /></td>
                <td><input className="input input-small" value={f.patronymic} onChange={setField('patronymic')} disabled={!editable} placeholder="—" aria-label={`${r.cell}: отчество`} /></td>
                <td>
                  <select className="input input-small" value={action} onChange={(e) => {
                    setDecision(r.key, { ...d, action: e.target.value });
                    if (e.target.value === 'link' && (!entry || entry.status === 'new')) setLinkFor(r.key);
                  }} aria-label={`${r.cell}: действие`}>
                    {actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                  </select>
                  {action === 'link' && (!entry || entry.status === 'new') && (
                    <button type="button" className="btn btn-link small" onClick={() => setLinkFor(r.key)}>{d.personId ? index.byId.get(d.personId)?.display_name : 'Выбрать человека…'}</button>
                  )}
                  {r.possibleDuplicates?.length > 0 && !entry && (
                    <span className="dup-hint">Похожая запись в архиве: {r.possibleDuplicates.map((p) => p.display_name).join(', ')}. Совпадение имени не повод объединять.</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {linkFor && (
        <Modal title="Связать запись с существующим человеком" onClose={() => setLinkFor(null)}>
          <PersonPicker autoFocus onSelect={(p) => { setDecision(linkFor, { ...(decisions[linkFor] || {}), action: 'link', personId: p.id }); setLinkFor(null); }} />
        </Modal>
      )}
    </div>
  );
}

function HypothesesList({ preview, confirmSet, toggleConfirm }) {
  const recByKey = new Map(preview.records.map((r) => [r.key, r]));
  const hypById = new Map(preview.hypotheses.map((h) => [h.id, h]));
  const text = (h) => {
    const a = recByKey.get(h.a);
    const b = recByKey.get(h.b);
    if (h.type === 'parent_child') return `${a.text} (${a.cell}) — родитель ${b.text} (${b.cell})`;
    if (h.type === 'partnership') return `${a.text} (${a.cell}) и ${b.text} (${b.cell}) — пара`;
    return `${a.text} (${a.cell}) и ${b.text} (${b.cell}) — один человек`;
  };
  return (
    <div className="stack-16">
      <Notice tone="info" icon={<HelpCircle size={20} />} title="По умолчанию люди импортируются без связей">
        Ниже — только предположения с объяснением. Отметьте связи, которые вы точно знаете, или оставьте всё как вопросы для раздела «Уточнить связи».
      </Notice>
      {preview.questions.map((q) => (
        <div key={q.id} className="question-card compact">
          <div className="chip-row"><span className="chip chip-green">{q.family}</span></div>
          <h4 className="question-title small">{q.title}</h4>
          {q.notes.map((n, i) => <p key={i} className="muted small"><Info size={13} /> {n}</p>)}
          <ul className="hyp-check-list">
            {q.hypothesisIds.map((id) => {
              const h = hypById.get(id);
              if (!h) return null;
              const disabled = h.type === 'same_person';
              return (
                <li key={id}>
                  <label className={`check-line ${disabled ? 'is-disabled' : ''}`}>
                    <input type="checkbox" checked={confirmSet.has(id)} disabled={disabled} onChange={() => toggleConfirm(id)} />
                    <span>
                      <span className="hyp-desc">{text(h)}</span>
                      <span className="muted small block">{h.basis.map((b) => b.text).join(' ')}</span>
                      {disabled && <span className="muted small block">Объединение записей выполняется после импорта.</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DiffTable({ preview, decisions, setDecision }) {
  const diff = preview.diff;
  const recByKey = new Map(preview.records.map((r) => [r.key, r]));
  const rows = [...diff.entries.filter((e) => e.status !== 'unchanged'), ...diff.removed];
  const unchanged = diff.entries.filter((e) => e.status === 'unchanged').length;
  return (
    <div className="stack-12">
      <p className="muted">Без изменений: {unchanged}. Ниже — отличия от предыдущей версии. Ручные правки не перезаписываются без вашего выбора.</p>
      {rows.length === 0 ? <p>Отличий в записях нет.</p> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Ячейка</th><th>Было</th><th>Стало</th><th>Человек</th><th>Что сделать</th></tr></thead>
            <tbody>
              {rows.map((e) => {
                const r = recByKey.get(e.key);
                const action = decisions[e.key]?.action || e.defaultAction;
                return (
                  <tr key={e.key + e.status} className={e.personEdited ? 'is-conflict' : ''}>
                    <td><strong>{e.key.split('!')[1]}</strong><span className="muted small block">{DIFF_LABELS[e.status]}</span></td>
                    <td>{e.old ? <code className="raw-text">{showSpaces(e.old.raw)}</code> : '—'}</td>
                    <td>{r ? <code className="raw-text">{showSpaces(r.raw)}</code> : '—'}</td>
                    <td>{e.person ? e.person.display_name : '—'}{e.personEdited && <span className="chip chip-hyp block-chip">есть ваши правки</span>}</td>
                    <td>
                      {e.actions ? (
                        <select className="input input-small" value={action} onChange={(ev) => setDecision(e.key, { ...(decisions[e.key] || {}), action: ev.target.value })} aria-label={`${e.key}: действие`}>
                          {e.actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a]}</option>)}
                        </select>
                      ) : <span className="muted small">Человек сохранится, запись будет помечена как отсутствующая</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RollbackDialog({ imp, onClose }) {
  const { save } = useData();
  const ui = useUi();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [deleteModified, setDeleteModified] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get(`/api/imports/${imp.id}/rollback-preview`).then(setPreview).catch((e) => setError(e.message));
  }, [imp.id]);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await save(() => api.post(`/api/imports/${imp.id}/rollback`, { deleteModified }), {});
      ui.toast(`Импорт отменён. Перед откатом создана копия ${r.backup.name}`);
      onClose();
    } catch (e) {
      reportError(ui, e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Откатить импорт?"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={!preview || busy}>{busy && <Loader2 size={16} className="spin" />} Откатить импорт</button>
        </>
      }
    >
      <p className="modal-lead">{imp.file_name} · {fmtDateTime(imp.created_at)}</p>
      {error && <p className="field-error">{error}</p>}
      {!preview && !error && <p className="muted"><Loader2 size={14} className="spin" /> Расчёт последствий…</p>}
      {preview && (
        <div className="stack-12">
          <ul className="notice-list">
            <li>Будут удалены люди без ваших изменений: {preview.personsToDelete.length}</li>
            <li>Предположений будет удалено: {preview.hypotheses} (из них с вашим решением: {preview.decidedHypotheses}), вопросов: {preview.questions}</li>
            <li>Связей, подтверждённых при импорте: {preview.importRelations}</li>
            {preview.restoredRecords > 0 && <li>Записей предыдущей версии будет восстановлено: {preview.restoredRecords}</li>}
            {preview.nameReverts.length > 0 && <li>Имён будет возвращено к прежним: {preview.nameReverts.filter((n) => n.revertible).length}; конфликтов: {preview.nameReverts.filter((n) => !n.revertible).length}</li>}
          </ul>
          {preview.personsModified.length > 0 && (
            <Notice tone="warning" title={`Записи с вашими изменениями: ${preview.personsModified.length}`}>
              <ul className="small">
                {preview.personsModified.map((m) => <li key={m.person.id}>{m.person.display_name} — {m.reasons.join(', ')}</li>)}
              </ul>
              <label className="check-line mt-8">
                <input type="checkbox" checked={deleteModified} onChange={(e) => setDeleteModified(e.target.checked)} />
                <span>Удалить и их (вместе с фотографиями и связями, добавленными позже)</span>
              </label>
              {!deleteModified && <p className="small">По умолчанию эти люди сохранятся — ваши правки не пропадут.</p>}
            </Notice>
          )}
          <p className="muted small">Перед откатом автоматически создаётся резервная копия.</p>
        </div>
      )}
    </Modal>
  );
}

export function ImportView({ onDone }) {
  const { data, save, reload } = useData();
  const ui = useUi();
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [confirmSet, setConfirmSet] = useState(new Set());
  const [tab, setTab] = useState('schema');
  const [result, setResult] = useState(null);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [drag, setDrag] = useState(false);
  const [rollback, setRollback] = useState(null);
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name) && !/spreadsheetml/.test(file.type)) {
      setError('Нужен файл Excel в формате .xlsx');
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      if (includeHidden) fd.append('includeHidden', '1');
      const p = await api.form('/api/imports/preview', fd);
      setPreview(p);
      setDecisions({});
      setConfirmSet(new Set());
      setTab(p.mode === 'update' ? 'diff' : 'schema');
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const commit = async () => {
    setCommitting(true);
    try {
      const r = await save(() => api.post('/api/imports/commit', { previewId: preview.previewId, records: decisions, confirm: [...confirmSet] }), { success: 'Импорт сохранён' });
      setResult(r.summary);
      setPreview(null);
    } catch (e) {
      reportError(ui, e);
    } finally {
      setCommitting(false);
    }
  };

  const cancel = () => {
    if (preview) api.post('/api/imports/discard', { previewId: preview.previewId }).catch(() => {});
    setPreview(null);
  };

  const plan = useMemo(() => {
    if (!preview) return null;
    let create = 0;
    let link = 0;
    let skip = 0;
    const diffByKey = new Map((preview.diff?.entries || []).map((e) => [e.key, e]));
    for (const r of preview.records) {
      const e = diffByKey.get(r.key);
      const a = decisions[r.key]?.action || e?.defaultAction || 'create';
      if (a === 'create') create++;
      else if (a === 'skip') skip++;
      else link++;
    }
    const missingLinks = preview.records.filter((r) => {
      const e = diffByKey.get(r.key);
      return decisions[r.key]?.action === 'link' && (!e || e.status === 'new') && !decisions[r.key]?.personId;
    }).length;
    return { create, link, skip, missingLinks };
  }, [preview, decisions]);

  const sheetGeo = preview ? Object.entries(preview.geometry) : [];
  return (
    <section className="view view-import">
      <ViewHeader title="Импорт из Excel" subtitle="Файл — источник данных. Расположение в таблице не подтверждает родство." />
      {!preview && (
        <div
          className={`dropzone ${drag ? 'is-drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
        >
          <FileSpreadsheet size={34} className="dz-icon" aria-hidden="true" />
          <h3>Перетащите файл .xlsx сюда</h3>
          <p className="muted">Имя файла может быть любым. Сначала вы увидите предварительный просмотр — ничего не сохранится без подтверждения.</p>
          <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="visually-hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} aria-label="Выбрать файл Excel" tabIndex={-1} />
          <button type="button" className="btn btn-primary" onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? <Loader2 size={17} className="spin" /> : <Upload size={17} />} {uploading ? 'Чтение файла…' : 'Выбрать файл'}
          </button>
          <label className="check-line small"><input type="checkbox" checked={includeHidden} onChange={(e) => setIncludeHidden(e.target.checked)} /> <span>Читать также скрытые листы</span></label>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}

      {result && (
        <div className="result-card" role="status">
          <CheckCircle2 size={28} className="ic-ok" />
          <div>
            <h3>Импорт сохранён</h3>
            <p>Людей создано: <strong>{result.persons}</strong>; исходных записей: <strong>{result.records}</strong>{result.linked ? `; связано с существующими: ${result.linked}` : ''}{result.updated ? `; имён обновлено: ${result.updated}` : ''}{result.kept ? `; правок сохранено: ${result.kept}` : ''}{result.skipped ? `; пропущено: ${result.skipped}` : ''}.</p>
            <p>Подтверждённых связей: <strong>{result.confirmed}</strong>; предположений для уточнения: <strong>{result.hypotheses}</strong>; вопросов: <strong>{result.questions}</strong>; проверок написания: {result.nameReviews}.</p>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={() => onDone('questions')}>Уточнить связи</button>
              <button type="button" className="btn btn-outline" onClick={() => onDone('tree')}><Network size={16} /> Открыть древо</button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="stack-16">
          <div className="file-card">
            <FileSpreadsheet size={28} aria-hidden="true" />
            <div className="grow">
              <h3 className="break">{preview.fileName}</h3>
              <p className="muted small">{fmtSize(preview.size)} · SHA-256 <code>{preview.checksum.slice(0, 16)}…</code></p>
              <p className="small">Листы: {preview.sheets.map((s) => `«${s.name}» (${s.state === 'visible' ? 'видимый' : 'скрытый'}${s.included ? `, записей: ${s.recordCount}` : ', не читается'})`).join(', ')}</p>
            </div>
          </div>
          {preview.mode === 'duplicate' && (
            <Notice tone="success" title="Этот файл уже импортирован">
              Файл с той же контрольной суммой импортирован {fmtDateTime(preview.duplicateOf.created_at)} («{preview.duplicateOf.file_name}»). Повторный импорт не создаёт дублей — сохранять нечего.
            </Notice>
          )}
          {preview.mode === 'update' && (
            <Notice tone="warning" title="Похоже, это новая версия ранее импортированного файла">
              Предыдущая версия: «{preview.previous.file_name}», {fmtDateTime(preview.previous.created_at)}. Проверьте различия: существующие люди не дублируются, ваши правки не перезаписываются молча.
              {preview.diff.entries.every((e) => e.status === 'unchanged') && preview.diff.removed.length === 0 && ' Записи в файле не изменились (файл, вероятно, просто пересохранён): новых людей не будет, обновятся только ссылки на исходный файл.'}
            </Notice>
          )}
          <ul className="check-list">
            {preview.checks.map((c, i) => <li key={i}>{LEVEL_ICON[c.level]}<span>{c.text}</span></li>)}
          </ul>
          <Segmented label="Раздел предпросмотра" value={tab} onChange={setTab} options={[
            { value: 'schema', label: 'Схема' },
            { value: 'records', label: 'Записи', count: preview.records.length },
            { value: 'hyps', label: 'Возможные связи', count: preview.hypotheses.length },
            ...(preview.diff ? [{ value: 'diff', label: 'Различия' }] : []),
            { value: 'names', label: 'Написание', count: preview.nameReviews.length },
          ]} />
          <div className="preview-body">
            {tab === 'schema' && sheetGeo.map(([name, g]) => (
              <div key={name}>
                <h4 className="subhead">Лист «{name}»</h4>
                <SheetGrid geometry={g} records={preview.records.filter((r) => r.sheet === name)} />
              </div>
            ))}
            {tab === 'records' && <RecordsTable preview={preview} decisions={decisions} setDecision={(k, v) => setDecisions((d) => ({ ...d, [k]: v }))} />}
            {tab === 'hyps' && <HypothesesList preview={preview} confirmSet={confirmSet} toggleConfirm={(id) => setConfirmSet((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />}
            {tab === 'diff' && preview.diff && <DiffTable preview={preview} decisions={decisions} setDecision={(k, v) => setDecisions((d) => ({ ...d, [k]: v }))} />}
            {tab === 'names' && (
              <div className="stack-12">
                <p className="muted">Необязательная задача: написание не исправляется автоматически.</p>
                {preview.nameReviews.length === 0 && <p>Замечаний нет.</p>}
                <ul className="check-list">{preview.nameReviews.map((n, i) => <li key={i}>{LEVEL_ICON.info}<span>{n.message}</span></li>)}</ul>
              </div>
            )}
          </div>
          <div className="commit-bar">
            <p className="small">
              {preview.mode === 'duplicate' ? 'Импорт не требуется.' : (
                <>Будет создано людей: <strong>{plan.create}</strong>{plan.link ? `, связано с существующими: ${plan.link}` : ''}{plan.skip ? `, пропущено: ${plan.skip}` : ''}. Подтверждённых связей: <strong>{confirmSet.size}</strong>; остальные предположения станут вопросами.</>
              )}
            </p>
            {plan?.missingLinks > 0 && <p className="field-error">Выберите существующего человека для записей со связыванием ({plan.missingLinks}).</p>}
            <div className="btn-row">
              <button type="button" className="btn btn-ghost" onClick={cancel}>{preview.mode === 'duplicate' ? 'Закрыть' : 'Отмена'}</button>
              {preview.mode !== 'duplicate' && (
                <button type="button" className="btn btn-primary" onClick={commit} disabled={committing || plan.missingLinks > 0 || preview.records.length === 0}>
                  {committing && <Loader2 size={16} className="spin" />} Импортировать
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <section className="history-section">
        <h2 className="h2">История импортов</h2>
        {data.imports.length === 0 ? <p className="muted">Импортов пока не было.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Дата</th><th>Файл</th><th>Итог</th><th>Состояние</th><th><span className="visually-hidden">Действия</span></th></tr></thead>
              <tbody>
                {data.imports.map((imp) => (
                  <tr key={imp.id} className={imp.status === 'rolled_back' ? 'is-muted' : ''}>
                    <td>{fmtDateTime(imp.created_at)}</td>
                    <td className="break">{imp.file_name}<span className="muted small block">{imp.mode === 'update' ? 'новая версия файла' : 'первый импорт'} · {imp.checksum.slice(0, 10)}…</span></td>
                    <td className="small">Людей: {imp.summary.persons ?? 0}, записей: {imp.summary.records ?? 0}, предположений: {imp.summary.hypotheses ?? 0}, вопросов: {imp.summary.questions ?? 0}{imp.summary.confirmed ? `, связей: ${imp.summary.confirmed}` : ''}</td>
                    <td>{imp.status === 'completed' ? <span className="status-tag tag-confirmed">Действует</span> : <span className="status-tag tag-rejected">Откачен {fmtDateTime(imp.rolled_back_at)}</span>}</td>
                    <td className="nowrap">
                      <a className="btn btn-small btn-ghost" href={`/api/imports/${imp.id}/file`} download><Download size={14} /> Файл</a>
                      {imp.status === 'completed' && <button type="button" className="btn btn-small btn-ghost-danger" onClick={() => setRollback(imp)}><RotateCcw size={14} /> Откатить…</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {rollback && <RollbackDialog imp={rollback} onClose={() => { setRollback(null); reload().catch(() => {}); }} />}
    </section>
  );
}
