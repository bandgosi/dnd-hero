// Карточка выбранного человека: сведения, связи, история; редактирование.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pencil, X, ImagePlus, Image as ImageIcon, Crop, Star, Trash2, RefreshCw, AlertCircle, Plus, Crosshair, Network, Table2,
  GitMerge, Check, FileSpreadsheet, BookOpen, Loader2, ChevronRight, Info,
} from 'lucide-react';
import { api, photoUrl } from '../api.js';
import { useData, useUi, reportError } from '../store.jsx';
import { Avatar, Menu, Field, Notice, Spinner, Modal } from './ui.jsx';
import { DateField, dateFieldError, PersonPicker } from './fields.jsx';
import { PhotoCropper, checkImageFile, ACCEPT } from './PhotoCropper.jsx';
import { RelationDialog, RelationEditDialog, ConfirmHypothesisDialog, MergeDialog, DeletePersonDialog, describeHyp } from './dialogs.jsx';
import { kinshipLabel, NOT_ENOUGH } from '../lib/kinship.js';
import { siblings } from '../lib/graph.js';
import {
  formatDate, birthOf, deathOf, SEX_LABELS, LIFE_LABELS, PARENT_KIND_LABELS, PARTNER_KIND_LABELS, PARTNER_STATUS_LABELS,
  SOURCE_KIND_LABELS, fmtDateTime, showSpaces, recordLabel, countText,
} from '../lib/format.js';

const NS = 'Не указано';

function InfoRow({ label, children, muted }) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd className={muted ? 'is-unknown' : ''}>{children}</dd>
    </div>
  );
}

export function PersonPanel({ personId, centerId, onClose, onSelect, onCenter, onShowTree, onShowExcel, onQuestions, closable }) {
  const { index } = useData();
  const person = personId ? index?.byId.get(personId) : null;
  const [tab, setTab] = useState('info');
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState(null);
  const headRef = useRef(null);
  useEffect(() => {
    setEditing(false);
    setTab('info');
  }, [personId]);

  if (!person) {
    return (
      <aside className="panel panel-empty" aria-label="Карточка человека">
        {closable && (
          <button type="button" className="icon-btn panel-close" onClick={onClose} aria-label="Закрыть карточку"><X size={20} /></button>
        )}
        <div className="empty-state">
          <div className="empty-icon"><Info size={28} /></div>
          <h3>Карточка человека</h3>
          <p>Выберите человека на древе, в исходной схеме или в списке «Все люди».</p>
        </div>
      </aside>
    );
  }
  const records = index.recordsByPerson.get(person.id) || [];
  const primaryRecord = records.find((r) => r.status === 'active') || records[0];
  const openQuestions = (index.questionsByPerson.get(person.id) || []).filter((q) => q.status !== 'resolved');

  return (
    <aside className="panel" aria-label={`Карточка: ${person.display_name}`}>
      <div className="panel-scroll">
        <header className="panel-head" ref={headRef}>
          <div className="panel-head-top">
            <Avatar person={person} size={96} variant="display" />
            <div className="panel-head-actions">
              <Menu
                items={[
                  { label: 'Сделать центром древа', icon: <Crosshair size={16} />, onClick: () => onCenter(person.id) },
                  { label: 'Показать на древе', icon: <Network size={16} />, onClick: () => onShowTree(person.id) },
                  primaryRecord && { label: 'Показать в исходной схеме', icon: <Table2 size={16} />, onClick: () => onShowExcel(person.id) },
                  { label: 'Объединить с другой записью…', icon: <GitMerge size={16} />, onClick: () => setDialog({ type: 'pickMerge' }) },
                  { label: 'Удалить человека…', icon: <Trash2 size={16} />, danger: true, onClick: () => setDialog({ type: 'delete' }) },
                ]}
              />
              {closable && (
                <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть карточку"><X size={20} /></button>
              )}
            </div>
          </div>
          <h2 className="panel-name">{person.display_name}</h2>
          {primaryRecord ? (
            <p className="panel-source">Исходная запись · {recordLabel(primaryRecord)}{records.length > 1 ? ` и ещё ${records.length - 1}` : ''}</p>
          ) : (
            <p className="panel-source">Добавлен вручную</p>
          )}
          {!editing && (
            <button type="button" className="btn btn-primary btn-block" onClick={() => setEditing(true)}>
              <Pencil size={17} /> Редактировать
            </button>
          )}
        </header>

        {editing ? (
          <PersonEditForm person={person} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Разделы карточки">
              {[['info', 'Сведения'], ['relations', 'Связи'], ['history', 'История']].map(([k, label]) => (
                <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`tabpanel-${k}`} className={tab === k ? 'is-active' : ''} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="panel-body">
              {tab === 'info' && <InfoTab person={person} records={records} openQuestions={openQuestions} onQuestions={onQuestions} />}
              {tab === 'relations' && <RelationsTab person={person} centerId={centerId} onSelect={onSelect} setDialog={setDialog} />}
              {tab === 'history' && <HistoryTab person={person} records={records} />}
            </div>
          </>
        )}
      </div>
      {dialog?.type === 'delete' && <DeletePersonDialog personId={person.id} onClose={() => setDialog(null)} onDeleted={onClose} />}
      {dialog?.type === 'pickMerge' && <PickMergeDialog person={person} onClose={() => setDialog(null)} onPicked={(other) => setDialog({ type: 'merge', other })} />}
      {dialog?.type === 'merge' && <MergeDialog personA={person.id} personB={dialog.other} onClose={() => setDialog(null)} onMerged={(id) => onSelect(id)} />}
      {dialog?.type === 'addRelation' && <RelationDialog personId={person.id} type={dialog.relType} onClose={() => setDialog(null)} />}
      {dialog?.type === 'editRelation' && <RelationEditDialog relation={dialog.relation} type={dialog.relKind} onClose={() => setDialog(null)} />}
      {dialog?.type === 'confirmHyp' && <ConfirmHypothesisDialog hypothesis={dialog.hypothesis} onClose={() => setDialog(null)} />}
    </aside>
  );
}

function PickMergeDialog({ person, onClose, onPicked }) {
  return (
    <Modal title="С какой записью объединить?" onClose={onClose}>
      <p className="muted">Совпадение имени само по себе не доказывает, что это один человек.</p>
      <PersonPicker exclude={new Set([person.id])} onSelect={(p) => onPicked(p.id)} autoFocus />
    </Modal>
  );
}

// ---------- Сведения ----------

function InfoTab({ person, records, openQuestions, onQuestions }) {
  const { index, save } = useData();
  const ui = useUi();
  const reviews = (index.reviewsByPerson.get(person.id) || []).filter((r) => r.status === 'open');
  const b = birthOf(person);
  const d = deathOf(person);
  const confirmParse = async () => {
    try {
      await save(() => api.put(`/api/persons/${person.id}`, { name_fields_status: 'confirmed' }), { success: 'Разбор ФИО подтверждён' });
    } catch (e) {
      reportError(ui, e);
    }
  };
  return (
    <div className="stack-24">
      <dl className="info-list">
        <InfoRow label="Дата рождения" muted={b.precision === 'unknown'}>{formatDate(b)}{person.birth_date_note ? <span className="muted small block">{person.birth_date_note}</span> : null}</InfoRow>
        <InfoRow label="Дата смерти" muted={d.precision === 'unknown'}>{formatDate(d)}{person.death_date_note ? <span className="muted small block">{person.death_date_note}</span> : null}</InfoRow>
        <InfoRow label="Жизненный статус" muted={person.life_status === 'unknown'}>{LIFE_LABELS[person.life_status]}</InfoRow>
        <InfoRow label="Пол" muted={!person.sex}>{person.sex ? SEX_LABELS[person.sex] : NS}</InfoRow>
        <InfoRow label="Место рождения" muted={!person.birth_place}>{person.birth_place || NS}</InfoRow>
        <InfoRow label="Место смерти" muted={!person.death_place}>{person.death_place || NS}</InfoRow>
      </dl>

      <PhotoSection person={person} />

      {openQuestions.length > 0 && (
        <Notice tone="warning" title="Нужно уточнить" icon={<AlertCircle size={22} />}
          action={<button type="button" className="btn btn-outline-warning btn-block mt-12" onClick={() => onQuestions(person.id)}>Проверить связи</button>}
        >
          {countText(openQuestions.length, 'открытый вопрос', 'открытых вопроса', 'открытых вопросов')} о родственных связях. Подтвердите связи перед добавлением в древо.
        </Notice>
      )}

      <section className="card-section">
        <h3 className="section-title">Имя</h3>
        {person.name_fields_status === 'suggested' && (
          <div className="draft-banner">
            <span>Разбор ФИО предложен автоматически по исходной строке — это черновик.</span>
            <button type="button" className="btn btn-small btn-outline" onClick={confirmParse}><Check size={14} /> Разбор верен</button>
          </div>
        )}
        <dl className="info-list">
          <InfoRow label="Фамилия" muted={!person.surname}>{person.surname || NS}</InfoRow>
          <InfoRow label="Имя" muted={!person.given_name}>{person.given_name || NS}</InfoRow>
          <InfoRow label="Отчество" muted={!person.patronymic}>{person.patronymic || NS}</InfoRow>
          <InfoRow label="Фамилия при рождении" muted={!person.birth_surname}>{person.birth_surname || NS}</InfoRow>
          <InfoRow label="Другие имена" muted={!person.other_names?.length}>{person.other_names?.length ? person.other_names.join(', ') : NS}</InfoRow>
        </dl>
        {reviews.length > 0 && (
          <div className="mt-12">
            {reviews.map((r) => (
              <p key={r.id} className="review-hint"><BookOpen size={14} /> {r.message}</p>
            ))}
            <button type="button" className="btn btn-link" onClick={() => onQuestions(person.id, 'names')}>Проверка написания (необязательно)</button>
          </div>
        )}
      </section>

      <section className="card-section">
        <h3 className="section-title">Биография</h3>
        {person.biography ? <p className="prose">{person.biography}</p> : <p className="is-unknown">{NS}</p>}
      </section>
      <section className="card-section">
        <h3 className="section-title">Заметки</h3>
        {person.notes ? <p className="prose">{person.notes}</p> : <p className="is-unknown">{NS}</p>}
      </section>

      <SourcesSection person={person} />

      <section className="card-section">
        <h3 className="section-title"><FileSpreadsheet size={16} /> Исходная запись Excel</h3>
        {records.length === 0 && <p className="is-unknown">Нет — человек добавлен вручную.</p>}
        {records.map((r) => (
          <div key={r.id} className="source-record">
            <dl className="info-list compact">
              <InfoRow label="Файл">{r.file_name}</InfoRow>
              <InfoRow label="Лист и ячейка">{r.sheet_name}!{r.cell}{r.merged_range ? ` (объединение ${r.merged_range})` : ''}</InfoRow>
              <InfoRow label="Исходный текст"><code className="raw-text" title="Символ ␣ — пробел в исходной строке">{showSpaces(r.raw_text)}</code></InfoRow>
              <InfoRow label="Состояние">{{ active: 'Актуальная запись', removed: 'Отсутствует в новой версии файла', rolled_back: 'Импорт отменён', person_deleted: 'Запись удалена', skipped: 'Пропущена при импорте' }[r.status] || r.status}</InfoRow>
              <InfoRow label="Импорт">{fmtDateTime(r.created_at)} · SHA-256 {r.checksum.slice(0, 10)}…</InfoRow>
            </dl>
          </div>
        ))}
      </section>
    </div>
  );
}

function PhotoSection({ person }) {
  const { index, save } = useData();
  const ui = useUi();
  const photos = index.photosByPerson.get(person.id) || [];
  const primary = photos.find((p) => p.id === person.primary_photo_id) || photos[0];
  const [crop, setCrop] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);
  const [intent, setIntent] = useState('add');

  const pick = (mode) => {
    setIntent(mode);
    fileRef.current.value = '';
    fileRef.current.click();
  };
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = checkImageFile(file);
    if (err) return ui.toast(err, 'error');
    setCrop({ file, mode: intent });
  };
  const upload = async ({ display, thumb, crop: rect }) => {
    setSaving(true);
    try {
      if (crop.photo) {
        const fd = new FormData();
        fd.append('display', display, 'display.jpg');
        fd.append('thumb', thumb, 'thumb.jpg');
        fd.append('crop', JSON.stringify(rect));
        await save(() => api.form(`/api/photos/${crop.photo.id}`, fd, 'PUT'), { success: 'Кадр обновлён' });
      } else {
        const fd = new FormData();
        fd.append('original', crop.file, crop.file.name);
        fd.append('display', display, 'display.jpg');
        fd.append('thumb', thumb, 'thumb.jpg');
        fd.append('crop', JSON.stringify(rect));
        if (crop.mode === 'replace' && primary) fd.append('replacePhotoId', primary.id);
        await save(() => api.form(`/api/persons/${person.id}/photos`, fd), { success: crop.mode === 'replace' ? 'Фотография заменена' : 'Фотография сохранена' });
      }
      setCrop(null);
    } catch (e) {
      reportError(ui, e);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (ph) => {
    const ok = await ui.confirm({ title: 'Удалить фотографию?', message: 'Файл будет удалён из архива. Если он есть в резервной копии, его можно восстановить оттуда.', confirmText: 'Удалить', tone: 'danger' });
    if (!ok) return;
    try {
      await save(() => api.del(`/api/photos/${ph.id}`), { success: 'Фотография удалена' });
    } catch (e) {
      reportError(ui, e);
    }
  };
  const makePrimary = async (ph) => {
    try {
      await save(() => api.post(`/api/persons/${person.id}/primary-photo`, { photoId: ph.id }), { success: 'Основная фотография выбрана' });
    } catch (e) {
      reportError(ui, e);
    }
  };
  const initialCrop = useMemo(() => {
    if (!crop?.photo?.crop) return null;
    try {
      return JSON.parse(crop.photo.crop);
    } catch {
      return null;
    }
  }, [crop]);

  return (
    <section className="card-section photo-section">
      <div className="photo-row">
        <h3 className="section-title">Фотография</h3>
        <input ref={fileRef} type="file" accept={ACCEPT} className="visually-hidden" onChange={onFile} aria-label="Выбрать файл фотографии" tabIndex={-1} />
        {!primary ? (
          <button type="button" className="upload-tile" onClick={() => pick('add')}>
            <ImageIcon size={22} /> <span>Загрузить фото</span>
          </button>
        ) : (
          <div className="photo-main">
            <img src={photoUrl(primary, 'display')} alt={`Фотография: ${person.display_name}`} />
          </div>
        )}
      </div>
      {primary && (
        <>
          <div className="photo-actions">
            <button type="button" className="btn btn-small btn-outline" onClick={() => pick('replace')}><RefreshCw size={14} /> Заменить</button>
            <button type="button" className="btn btn-small btn-outline" onClick={() => setCrop({ photo: primary })}><Crop size={14} /> Кадрировать</button>
            <button type="button" className="btn btn-small btn-outline" onClick={() => pick('add')}><ImagePlus size={14} /> Ещё фото</button>
            <button type="button" className="btn btn-small btn-ghost-danger" onClick={() => remove(primary)}><Trash2 size={14} /> Удалить</button>
          </div>
          {photos.length > 1 && (
            <div className="photo-gallery" aria-label="Все фотографии">
              {photos.map((ph) => (
                <div key={ph.id} className={`gallery-item ${ph.id === primary.id ? 'is-primary' : ''}`}>
                  <img src={photoUrl(ph, 'thumb')} alt="" />
                  {ph.id !== primary.id && (
                    <div className="gallery-actions">
                      <button type="button" className="icon-btn small" onClick={() => makePrimary(ph)} aria-label="Сделать основной"><Star size={14} /></button>
                      <button type="button" className="icon-btn small" onClick={() => remove(ph)} aria-label="Удалить фото"><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {crop && (
        <PhotoCropper
          file={crop.file}
          originalUrl={crop.photo ? photoUrl(crop.photo, 'original') : null}
          initialCrop={initialCrop}
          title={crop.photo ? 'Изменить кадр' : crop.mode === 'replace' ? 'Новая фотография вместо прежней' : 'Новая фотография'}
          saving={saving}
          onCancel={() => setCrop(null)}
          onDone={upload}
        />
      )}
    </section>
  );
}

function SourcesSection({ person }) {
  const { index, save } = useData();
  const ui = useUi();
  const list = index.sourcesByPerson.get(person.id) || [];
  const [form, setForm] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await save(() => api.put(`/api/sources/${form.id}`, form), { success: 'Источник сохранён' });
      else await save(() => api.post(`/api/persons/${person.id}/sources`, form), { success: 'Источник добавлен' });
      setForm(null);
    } catch (err) {
      reportError(ui, err);
    }
  };
  const remove = async (s) => {
    const ok = await ui.confirm({ title: 'Удалить источник?', message: s.title, confirmText: 'Удалить', tone: 'danger' });
    if (!ok) return;
    try {
      await save(() => api.del(`/api/sources/${s.id}`), { success: 'Источник удалён' });
    } catch (err) {
      reportError(ui, err);
    }
  };
  return (
    <section className="card-section">
      <h3 className="section-title">Источники</h3>
      {list.length === 0 && !form && <p className="is-unknown">Источники не указаны.</p>}
      <ul className="source-list">
        {list.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.title}</strong> <span className="chip chip-muted">{SOURCE_KIND_LABELS[s.kind]}</span>
              {s.details && <p className="prose small">{s.details}</p>}
              {s.url && <p className="small break"><a href={s.url} target="_blank" rel="noreferrer noopener">{s.url}</a></p>}
            </div>
            <div className="row-actions">
              <button type="button" className="icon-btn small" aria-label="Изменить источник" onClick={() => setForm({ ...s })}><Pencil size={14} /></button>
              <button type="button" className="icon-btn small" aria-label="Удалить источник" onClick={() => remove(s)}><Trash2 size={14} /></button>
            </div>
          </li>
        ))}
      </ul>
      {form ? (
        <form className="stack-12 source-form" onSubmit={submit}>
          <Field label="Название" htmlFor="src-title"><input id="src-title" className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Например: свидетельство о рождении" /></Field>
          <Field label="Вид" htmlFor="src-kind">
            <select id="src-kind" className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(SOURCE_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Подробности" htmlFor="src-details"><textarea id="src-details" className="input" rows={3} value={form.details || ''} onChange={(e) => setForm({ ...form, details: e.target.value })} /></Field>
          <Field label="Ссылка (необязательно)" htmlFor="src-url"><input id="src-url" className="input" value={form.url || ''} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Отмена</button>
            <button type="submit" className="btn btn-primary">Сохранить источник</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-outline btn-small" onClick={() => setForm({ title: '', kind: 'document', details: '', url: '' })}><Plus size={14} /> Добавить источник</button>
      )}
    </section>
  );
}

// ---------- Связи ----------

function PersonLine({ id, meta, onSelect, onEdit, editLabel }) {
  const { index } = useData();
  const p = index.byId.get(id);
  if (!p) return null;
  return (
    <li className="rel-line">
      <button type="button" className="rel-person" onClick={() => onSelect(id)}>
        <Avatar person={p} size={36} />
        <span>
          <span className="rel-name">{p.display_name}</span>
          {meta && <span className="rel-meta">{meta}</span>}
        </span>
      </button>
      {onEdit && <button type="button" className="icon-btn small" onClick={onEdit} aria-label={editLabel || 'Изменить связь'}><Pencil size={14} /></button>}
    </li>
  );
}

function RelationsTab({ person, centerId, onSelect, setDialog }) {
  const { index, save } = useData();
  const ui = useUi();
  const parents = index.parentsOf.get(person.id) || [];
  const children = index.childrenOf.get(person.id) || [];
  const partners = index.partnersOf.get(person.id) || [];
  const sibs = [...siblings(person.id, index)];
  const hyps = (index.hypsByPerson.get(person.id) || []).filter((h) => h.status === 'open' || h.status === 'deferred');
  const kin = centerId && centerId !== person.id ? kinshipLabel(centerId, person.id, index) : null;
  const center = centerId ? index.byId.get(centerId) : null;

  // Дети, сгруппированные по второму родителю.
  const groups = new Map();
  for (const r of children) {
    const others = (index.parentsOf.get(r.child_id) || []).filter((x) => x.parent_id !== person.id).map((x) => x.parent_id);
    const key = others.sort().join('|') || '-';
    if (!groups.has(key)) groups.set(key, { others, items: [] });
    groups.get(key).items.push(r);
  }
  const reject = async (h) => {
    try {
      await save(() => api.post(`/api/hypotheses/${h.id}/reject`, {}), { success: 'Предположение отклонено' });
    } catch (e) {
      reportError(ui, e);
    }
  };
  const kindMeta = (r) => (r.kind && r.kind !== 'unknown' ? PARENT_KIND_LABELS[r.kind] : 'тип родительства не указан');
  return (
    <div className="stack-24">
      {center && centerId !== person.id && (
        <div className={`kin-box ${kin?.unknown ? 'is-unknown' : ''}`}>
          <span className="muted small">Кем приходится центральному человеку ({center.display_name})</span>
          <strong>{kin?.label || NOT_ENOUGH}</strong>
        </div>
      )}
      {!centerId && <p className="muted small">Сделайте кого-нибудь центром древа (меню «⋮»), чтобы увидеть родственные подписи. Подписи считаются только по подтверждённым связям.</p>}

      <section>
        <div className="rel-head"><h3 className="section-title">Родители</h3>
          <button type="button" className="btn btn-small btn-outline" onClick={() => setDialog({ type: 'addRelation', relType: 'parent' })}><Plus size={14} /> Родитель</button></div>
        {parents.length === 0 ? <p className="is-unknown">Не указаны</p> : (
          <ul className="rel-list">{parents.map((r) => <PersonLine key={r.id} id={r.parent_id} meta={kindMeta(r)} onSelect={onSelect} onEdit={() => setDialog({ type: 'editRelation', relation: r, relKind: 'parent_child' })} />)}</ul>
        )}
      </section>

      <section>
        <div className="rel-head"><h3 className="section-title">Партнёры</h3>
          <button type="button" className="btn btn-small btn-outline" onClick={() => setDialog({ type: 'addRelation', relType: 'partner' })}><Plus size={14} /> Партнёр</button></div>
        {partners.length === 0 ? <p className="is-unknown">Не указаны</p> : (
          <ul className="rel-list">{partners.map((r) => {
            const other = r.person1_id === person.id ? r.person2_id : r.person1_id;
            const meta = [PARTNER_KIND_LABELS[r.kind], PARTNER_STATUS_LABELS[r.status], r.start_precision !== 'unknown' ? `с ${formatDate({ precision: r.start_precision, date: r.start_date, dateEnd: r.start_date_end })}` : null].join(' · ');
            return <PersonLine key={r.id} id={other} meta={meta} onSelect={onSelect} onEdit={() => setDialog({ type: 'editRelation', relation: r, relKind: 'partnership' })} />;
          })}</ul>
        )}
      </section>

      <section>
        <div className="rel-head"><h3 className="section-title">Дети</h3>
          <button type="button" className="btn btn-small btn-outline" onClick={() => setDialog({ type: 'addRelation', relType: 'child' })}><Plus size={14} /> Ребёнок</button></div>
        {children.length === 0 ? <p className="is-unknown">Не указаны</p> : [...groups.values()].map((g) => (
          <div key={g.others.join('|') || '-'} className="child-group">
            <p className="muted small">{g.others.length ? `Второй родитель: ${g.others.map((id) => index.byId.get(id)?.display_name).join(', ')}` : 'Второй родитель не указан'}</p>
            <ul className="rel-list">{g.items.map((r) => <PersonLine key={r.id} id={r.child_id} meta={kindMeta(r)} onSelect={onSelect} onEdit={() => setDialog({ type: 'editRelation', relation: r, relKind: 'parent_child' })} />)}</ul>
          </div>
        ))}
      </section>

      <section>
        <h3 className="section-title">Братья и сёстры</h3>
        <p className="muted small">Вычисляются по общим подтверждённым родителям.</p>
        {sibs.length === 0 ? <p className="is-unknown">Не найдены</p> : (
          <ul className="rel-list">{sibs.map((id) => <PersonLine key={id} id={id} meta={kinshipLabel(person.id, id, index)?.label} onSelect={onSelect} />)}</ul>
        )}
      </section>

      {hyps.length > 0 && (
        <section className="hyp-section">
          <h3 className="section-title hyp-title">Предположения <span className="chip chip-hyp">не подтверждены</span></h3>
          <p className="muted small">Не участвуют в древе и в родственных подписях.</p>
          <ul className="hyp-list">
            {hyps.map((h) => {
              const d = describeHyp(h, index);
              return (
                <li key={h.id} className="hyp-item">
                  <span className="hyp-mark" aria-hidden="true">?</span>
                  <div className="hyp-text">
                    <span>{d.text}</span>
                    <details><summary>Основание</summary><ul className="basis-list">{h.basis.map((b, i) => <li key={i}>{b.text}</li>)}</ul></details>
                    <div className="btn-row">
                      <button type="button" className="btn btn-small btn-primary" onClick={() => setDialog({ type: 'confirmHyp', hypothesis: h })}>{h.type === 'same_person' ? 'Объединить…' : 'Подтвердить…'}</button>
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => reject(h)}>Отклонить</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------- История ----------

const FIELD_NAMES = {
  display_name: 'Отображаемое имя', surname: 'Фамилия', given_name: 'Имя', patronymic: 'Отчество', birth_surname: 'Фамилия при рождении',
  other_names: 'Другие имена', sex: 'Пол', life_status: 'Жизненный статус', birth_precision: 'Точность даты рождения', birth_date: 'Дата рождения',
  birth_date_end: 'Дата рождения (конец)', death_precision: 'Точность даты смерти', death_date: 'Дата смерти', death_date_end: 'Дата смерти (конец)',
  birth_place: 'Место рождения', death_place: 'Место смерти', biography: 'Биография', notes: 'Заметки', name_fields_status: 'Разбор ФИО',
  birth_date_note: 'Пояснение к дате рождения', death_date_note: 'Пояснение к дате смерти',
};

function HistoryTab({ person }) {
  const { data } = useData();
  const [state, setState] = useState({ loading: true, items: [], error: null });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.get(`/api/persons/${person.id}/history`)
      .then((r) => !cancelled && setState({ loading: false, items: r.history, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, items: [], error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [person.id, data]);
  if (state.loading && !state.items.length) return <Spinner text="Загрузка истории…" />;
  if (state.error) return <p className="field-error">{state.error}</p>;
  if (!state.items.length) return <p className="is-unknown">Изменений пока нет.</p>;
  const ACTOR = { user: 'вы', import: 'импорт', system: 'система' };
  const show = (v) => (v == null || v === '' ? '—' : String(v).length > 120 ? String(v).slice(0, 120) + '…' : String(v));
  return (
    <ol className="history">
      {state.items.map((h) => (
        <li key={h.id}>
          <span className="history-dot" aria-hidden="true" />
          <div>
            <p className="history-summary">{h.summary}</p>
            <p className="muted small">{fmtDateTime(h.at)} · {ACTOR[h.actor] || h.actor}</p>
            {h.details?.changes && (
              <details>
                <summary>Подробнее</summary>
                <ul className="change-list">
                  {Object.entries(h.details.changes).map(([k, v]) => (
                    <li key={k}><strong>{FIELD_NAMES[k] || k}:</strong> {show(v.before)} <ChevronRight size={12} /> {show(v.after)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------- Редактирование ----------

function PersonEditForm({ person, onCancel, onSaved }) {
  const { save } = useData();
  const ui = useUi();
  const [f, setF] = useState(() => ({
    display_name: person.display_name || '',
    surname: person.surname || '',
    given_name: person.given_name || '',
    patronymic: person.patronymic || '',
    birth_surname: person.birth_surname || '',
    other_names: (person.other_names || []).join('\n'),
    sex: person.sex || '',
    life_status: person.life_status,
    birth: { precision: person.birth_precision, date: person.birth_date, dateEnd: person.birth_date_end },
    death: { precision: person.death_precision, date: person.death_date, dateEnd: person.death_date_end },
    birth_date_note: person.birth_date_note || '',
    death_date_note: person.death_date_note || '',
    birth_place: person.birth_place || '',
    death_place: person.death_place || '',
    biography: person.biography || '',
    notes: person.notes || '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const bErr = dateFieldError('Дата рождения', f.birth);
  const dErr = dateFieldError('Дата смерти', f.death);
  const nameErr = !(f.display_name || f.surname || f.given_name || f.patronymic).trim() ? 'Укажите хотя бы одно из полей имени' : null;
  const submit = async (e) => {
    e.preventDefault();
    if (bErr || dErr || nameErr) return;
    setBusy(true);
    try {
      await save((force) => api.put(`/api/persons/${person.id}`, {
        person: {
          display_name: f.display_name, surname: f.surname, given_name: f.given_name, patronymic: f.patronymic, birth_surname: f.birth_surname,
          other_names: f.other_names.split('\n'), sex: f.sex || null, life_status: f.life_status,
          birth_precision: f.birth.precision, birth_date: f.birth.date, birth_date_end: f.birth.dateEnd,
          death_precision: f.death.precision, death_date: f.death.date, death_date_end: f.death.dateEnd,
          birth_date_note: f.birth_date_note, death_date_note: f.death_date_note,
          birth_place: f.birth_place, death_place: f.death_place, biography: f.biography, notes: f.notes,
        },
        force,
      }), { success: 'Сведения сохранены' });
      onSaved();
    } catch (err) {
      reportError(ui, err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="edit-form" onSubmit={submit} noValidate>
      <fieldset className="form-group">
        <legend>Имя</legend>
        <Field label="Отображаемое имя" htmlFor="ef-dn" error={nameErr} hint="Исходная строка Excel хранится отдельно и не меняется.">
          <input id="ef-dn" className="input" value={f.display_name} onChange={set('display_name')} />
        </Field>
        <div className="form-grid two">
          <Field label="Фамилия" htmlFor="ef-sn"><input id="ef-sn" className="input" value={f.surname} onChange={set('surname')} /></Field>
          <Field label="Имя" htmlFor="ef-gn"><input id="ef-gn" className="input" value={f.given_name} onChange={set('given_name')} /></Field>
          <Field label="Отчество" htmlFor="ef-pn"><input id="ef-pn" className="input" value={f.patronymic} onChange={set('patronymic')} /></Field>
          <Field label="Фамилия при рождении" htmlFor="ef-bs"><input id="ef-bs" className="input" value={f.birth_surname} onChange={set('birth_surname')} /></Field>
        </div>
        <Field label="Другие имена и варианты написания" hint="По одному на строку — они тоже участвуют в поиске." htmlFor="ef-on">
          <textarea id="ef-on" className="input" rows={2} value={f.other_names} onChange={set('other_names')} />
        </Field>
      </fieldset>
      <fieldset className="form-group">
        <legend>Даты и статус</legend>
        <DateField label="Дата рождения" value={f.birth} onChange={(v) => setF({ ...f, birth: v })} />
        <Field label="Пояснение к дате рождения" htmlFor="ef-bn"><input id="ef-bn" className="input" value={f.birth_date_note} onChange={set('birth_date_note')} placeholder="Например: по словам бабушки" /></Field>
        <DateField label="Дата смерти" value={f.death} onChange={(v) => setF({ ...f, death: v })} />
        <Field label="Пояснение к дате смерти" htmlFor="ef-dn2"><input id="ef-dn2" className="input" value={f.death_date_note} onChange={set('death_date_note')} /></Field>
        <div className="form-grid two">
          <Field label="Жизненный статус" htmlFor="ef-life" hint="Отсутствие даты смерти не означает «жив».">
            <select id="ef-life" className="input" value={f.life_status} onChange={set('life_status')}>
              {Object.entries(LIFE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Пол (необязательно)" htmlFor="ef-sex">
            <select id="ef-sex" className="input" value={f.sex} onChange={set('sex')}>
              <option value="">Не указан</option>
              {Object.entries(SEX_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>
      <fieldset className="form-group">
        <legend>Места</legend>
        <div className="form-grid two">
          <Field label="Место рождения" htmlFor="ef-bp"><input id="ef-bp" className="input" value={f.birth_place} onChange={set('birth_place')} /></Field>
          <Field label="Место смерти" htmlFor="ef-dp"><input id="ef-dp" className="input" value={f.death_place} onChange={set('death_place')} /></Field>
        </div>
      </fieldset>
      <fieldset className="form-group">
        <legend>Биография и заметки</legend>
        <Field label="Биография" htmlFor="ef-bio"><textarea id="ef-bio" className="input" rows={6} value={f.biography} onChange={set('biography')} /></Field>
        <Field label="Заметки" htmlFor="ef-notes"><textarea id="ef-notes" className="input" rows={3} value={f.notes} onChange={set('notes')} /></Field>
      </fieldset>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Отмена</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !!bErr || !!dErr || !!nameErr}>
          {busy && <Loader2 size={16} className="spin" />} {busy ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
