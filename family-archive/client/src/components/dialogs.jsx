// Диалоги работы со связями и людьми.
import { useEffect, useMemo, useState } from 'react';
import { UserPlus, Users, Link2, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../api.js';
import { useData, useUi, reportError } from '../store.jsx';
import { Modal, Field, Segmented, Avatar, Notice } from './ui.jsx';
import { PersonPicker, DateField, dateFieldError } from './fields.jsx';
import { ancestors, descendants } from '../lib/graph.js';
import {
  PARENT_KIND_LABELS, PARTNER_KIND_LABELS, PARTNER_STATUS_LABELS, SEX_LABELS, LIFE_LABELS, searchKey, lifeSpan, formatDate,
} from '../lib/format.js';

const TYPE_TITLES = { parent: 'Добавить родителя', child: 'Добавить ребёнка', partner: 'Добавить партнёра' };

function KindFields({ type, value, onChange }) {
  if (type === 'partner') {
    return (
      <div className="form-grid two">
        <Field label="Вид отношений" htmlFor="rel-kind">
          <select id="rel-kind" className="input" value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value })}>
            {Object.entries(PARTNER_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Статус" htmlFor="rel-status">
          <select id="rel-status" className="input" value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })}>
            {Object.entries(PARTNER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
    );
  }
  return (
    <Field label="Тип родительства" hint="Если неизвестно — оставьте «Тип не указан»." htmlFor="rel-kind">
      <select id="rel-kind" className="input" value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value })}>
        {Object.entries(PARENT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </Field>
  );
}

function NameFields({ value, onChange, idp = 'np' }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="form-grid two">
      <Field label="Отображаемое имя" hint="Как подписывать карточку. Можно оставить пустым — соберётся из частей." htmlFor={`${idp}-dn`}>
        <input id={`${idp}-dn`} className="input" value={value.display_name} onChange={set('display_name')} />
      </Field>
      <Field label="Фамилия" htmlFor={`${idp}-sn`}>
        <input id={`${idp}-sn`} className="input" value={value.surname} onChange={set('surname')} />
      </Field>
      <Field label="Имя" htmlFor={`${idp}-gn`}>
        <input id={`${idp}-gn`} className="input" value={value.given_name} onChange={set('given_name')} />
      </Field>
      <Field label="Отчество" htmlFor={`${idp}-pn`}>
        <input id={`${idp}-pn`} className="input" value={value.patronymic} onChange={set('patronymic')} />
      </Field>
    </div>
  );
}

function useDuplicates(names) {
  const { data } = useData();
  return useMemo(() => {
    const parts = [names.display_name, [names.surname, names.given_name].filter(Boolean).join(' ')].map((x) => searchKey(x || '')).filter((x) => x.length >= 3);
    if (!parts.length) return [];
    return data.persons.filter((p) => {
      const k = searchKey([p.display_name, ...(p.other_names || [])].join(' '));
      return parts.some((q) => q.split(' ').every((w) => k.includes(w)));
    }).slice(0, 5);
  }, [data, names.display_name, names.surname, names.given_name]);
}

function DuplicateHint({ list, onPick }) {
  if (!list.length) return null;
  return (
    <Notice tone="warning" title="Похожие записи уже есть" icon={<AlertTriangle size={18} />}>
      <p>Возможно, это тот же человек. Выберите существующую запись, чтобы не создавать дубль:</p>
      <div className="chip-row">
        {list.map((p) => (
          <button key={p.id} type="button" className="chip chip-button" onClick={() => onPick(p)}>
            {p.display_name}
          </button>
        ))}
      </div>
    </Notice>
  );
}

const emptyNames = { display_name: '', surname: '', given_name: '', patronymic: '' };

// Добавление родителя / ребёнка / партнёра к человеку.
export function RelationDialog({ personId, type, onClose, onDone }) {
  const { data, index, save } = useData();
  const ui = useUi();
  const person = index.byId.get(personId);
  const [mode, setMode] = useState('existing');
  const [picked, setPicked] = useState(null);
  const [names, setNames] = useState(emptyNames);
  const [kind, setKind] = useState({ kind: 'unknown', status: 'unknown' });
  const [busy, setBusy] = useState(false);
  const dups = useDuplicates(mode === 'new' ? names : emptyNames);

  const anc = useMemo(() => ancestors(personId, index), [personId, index]);
  const desc = useMemo(() => descendants(personId, index), [personId, index]);
  const disabledReason = (id) => {
    if (type === 'parent') {
      if ((index.parentsOf.get(personId) || []).some((r) => r.parent_id === id)) return 'уже указан родителем';
      if (desc.has(id)) return 'это потомок — получился бы цикл предков';
    }
    if (type === 'child') {
      if ((index.childrenOf.get(personId) || []).some((r) => r.child_id === id)) return 'уже указан ребёнком';
      if (anc.has(id)) return 'это предок — получился бы цикл предков';
    }
    return null;
  };

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'existing') {
        if (!picked) return;
        const body = type === 'parent' ? { parentId: picked.id, childId: personId, kind: kind.kind }
          : type === 'child' ? { parentId: personId, childId: picked.id, kind: kind.kind }
            : { person1Id: personId, person2Id: picked.id, kind: kind.kind, status: kind.status };
        const url = type === 'partner' ? '/api/relations/partnerships' : '/api/relations/parent-child';
        await save((force) => api.post(url, { ...body, force }), { success: 'Связь сохранена' });
      } else {
        const relType = type === 'parent' ? 'parent' : type === 'child' ? 'child' : 'partner';
        await save((force) => api.post('/api/persons', { person: names, relation: { type: relType, personId, kind: kind.kind, status: kind.status }, force }), { success: 'Человек добавлен и связан' });
      }
      onDone?.();
      onClose();
    } catch (e) {
      reportError(ui, e);
    } finally {
      setBusy(false);
    }
  };

  const canSave = mode === 'existing' ? !!picked : !!(names.display_name || names.surname || names.given_name || names.patronymic).trim();
  return (
    <Modal
      title={`${TYPE_TITLES[type]}: ${person?.display_name}`}
      onClose={onClose}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSave || busy}>
            {busy && <Loader2 size={16} className="spin" />} Сохранить связь
          </button>
        </>
      }
    >
      <Segmented
        label="Кого связать"
        value={mode}
        onChange={(v) => setMode(v)}
        options={[
          { value: 'existing', label: 'Выбрать из архива', icon: <Users size={16} /> },
          { value: 'new', label: 'Новый человек', icon: <UserPlus size={16} /> },
        ]}
      />
      <div className="stack-16 mt-16">
        {mode === 'existing' ? (
          <PersonPicker exclude={new Set([personId])} disabledReason={disabledReason} selectedId={picked?.id} onSelect={setPicked} autoFocus />
        ) : (
          <>
            <NameFields value={names} onChange={setNames} />
            <DuplicateHint list={dups} onPick={(p) => { setMode('existing'); setPicked(p); }} />
          </>
        )}
        {picked && mode === 'existing' && (
          <p className="muted">Выбрано: <strong>{picked.display_name}</strong></p>
        )}
        <KindFields type={type} value={kind} onChange={setKind} />
        <p className="muted small">Связь сохраняется как подтверждённая вами. Второй родитель и партнёрство не назначаются автоматически.</p>
      </div>
    </Modal>
  );
}

// Редактирование подтверждённой связи (исправление ошибочного подтверждения — удаление).
export function RelationEditDialog({ relation, type, onClose }) {
  const { index, save } = useData();
  const ui = useUi();
  const isPC = type === 'parent_child';
  const [form, setForm] = useState(() => (isPC
    ? { kind: relation.kind, kindNote: relation.kind_note || '', notes: relation.notes || '' }
    : {
      kind: relation.kind,
      status: relation.status,
      start: { precision: relation.start_precision, date: relation.start_date, dateEnd: relation.start_date_end },
      end: { precision: relation.end_precision, date: relation.end_date, dateEnd: relation.end_date_end },
      notes: relation.notes || '',
    }));
  const [busy, setBusy] = useState(false);
  const fromHyp = !!relation.hypothesis_id && index.hypById.has(relation.hypothesis_id);
  const a = index.byId.get(isPC ? relation.parent_id : relation.person1_id);
  const b = index.byId.get(isPC ? relation.child_id : relation.person2_id);
  const dateErr = !isPC && (dateFieldError('Начало', form.start) || dateFieldError('Окончание', form.end));

  const submit = async () => {
    setBusy(true);
    try {
      if (isPC) await save(() => api.put(`/api/relations/parent-child/${relation.id}`, form), { success: 'Связь обновлена' });
      else {
        await save((force) => api.put(`/api/relations/partnerships/${relation.id}`, {
          kind: form.kind,
          status: form.status,
          startPrecision: form.start.precision, startDate: form.start.date, startDateEnd: form.start.dateEnd,
          endPrecision: form.end.precision, endDate: form.end.date, endDateEnd: form.end.dateEnd,
          notes: form.notes,
          force,
        }), { success: 'Партнёрство обновлено' });
      }
      onClose();
    } catch (e) {
      reportError(ui, e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await ui.confirm({
      title: 'Удалить подтверждённую связь?',
      message: `${a?.display_name} — ${b?.display_name}. ${fromHyp ? 'Связь была подтверждена из предположения: оно вернётся в очередь «Уточнить связи».' : 'Люди останутся в архиве.'}`,
      confirmText: 'Удалить связь',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const url = isPC ? `/api/relations/parent-child/${relation.id}` : `/api/relations/partnerships/${relation.id}`;
      await save(() => api.del(url), { success: 'Связь удалена' });
      onClose();
    } catch (e) {
      reportError(ui, e);
    }
  };

  return (
    <Modal
      title={isPC ? 'Связь «родитель — ребёнок»' : 'Партнёрство'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost-danger mr-auto" onClick={remove}><Trash2 size={16} /> Удалить связь</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !!dateErr}>
            {busy && <Loader2 size={16} className="spin" />} Сохранить
          </button>
        </>
      }
    >
      <div className="relation-pair">
        <span><Avatar person={a} size={32} /> {a?.display_name}</span>
        <span className="muted">{isPC ? 'родитель →' : 'и'}</span>
        <span><Avatar person={b} size={32} /> {b?.display_name}</span>
      </div>
      <div className="stack-16 mt-16">
        {isPC ? (
          <>
            <KindFields type="parent" value={form} onChange={setForm} />
            {form.kind === 'other' && (
              <Field label="Уточнение" htmlFor="kind-note">
                <input id="kind-note" className="input" value={form.kindNote} onChange={(e) => setForm({ ...form, kindNote: e.target.value })} />
              </Field>
            )}
          </>
        ) : (
          <>
            <KindFields type="partner" value={form} onChange={setForm} />
            <DateField label="Начало" value={form.start} onChange={(v) => setForm({ ...form, start: v })} />
            <DateField label="Окончание" value={form.end} onChange={(v) => setForm({ ...form, end: v })} />
          </>
        )}
        <Field label="Заметки" htmlFor="rel-notes">
          <textarea id="rel-notes" className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
        <p className="muted small">Происхождение: {relation.origin === 'hypothesis' ? 'подтверждено из предположения' : relation.origin === 'import' ? 'подтверждено при импорте' : 'указано вручную'}.</p>
      </div>
    </Modal>
  );
}

export function describeHyp(h, index) {
  const a = index.byId.get(h.person_a)?.display_name || '—';
  const b = index.byId.get(h.person_b)?.display_name || '—';
  if (h.type === 'parent_child') return { a, b, text: `${a} — родитель ${b}`, short: 'родитель' };
  if (h.type === 'partnership') return { a, b, text: `${a} и ${b} — пара`, short: 'пара' };
  return { a, b, text: `${a} и ${b} — один и тот же человек`, short: 'один человек' };
}

// Подтверждение предположения с уточнением вида связи.
export function ConfirmHypothesisDialog({ hypothesis, onClose }) {
  const { index, save } = useData();
  const ui = useUi();
  const [kind, setKind] = useState({ kind: 'unknown', status: 'unknown' });
  const [busy, setBusy] = useState(false);
  if (hypothesis.type === 'same_person') return <MergeDialog personA={hypothesis.person_a} personB={hypothesis.person_b} hypothesis={hypothesis} onClose={onClose} />;
  const d = describeHyp(hypothesis, index);
  const submit = async () => {
    setBusy(true);
    try {
      await save((force) => api.post(`/api/hypotheses/${hypothesis.id}/confirm`, { kind: kind.kind, status: kind.status, force }), { success: 'Связь подтверждена' });
      onClose();
    } catch (e) {
      reportError(ui, e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Подтвердить связь"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy && <Loader2 size={16} className="spin" />} Подтвердить
          </button>
        </>
      }
    >
      <p className="modal-lead">{d.text}</p>
      <ul className="basis-list">
        {hypothesis.basis.map((b, i) => <li key={i}>{b.text}</li>)}
      </ul>
      <div className="mt-16">
        <KindFields type={hypothesis.type === 'partnership' ? 'partner' : 'parent'} value={kind} onChange={setKind} />
      </div>
      <p className="muted small mt-8">Подтверждается только эта связь. {hypothesis.type === 'parent_child' ? 'Второй родитель и пара родителей не создаются.' : 'Дети этой пары не назначаются автоматически.'}</p>
    </Modal>
  );
}

const MERGE_VALUE = (v) => (Array.isArray(v) ? formatDate({ precision: v[0], date: v[1], dateEnd: v[2] }) : v ?? '—');

// Объединение двух записей одного человека.
export function MergeDialog({ personA, personB, hypothesis, onClose, onMerged }) {
  const { index, save } = useData();
  const ui = useUi();
  const [primary, setPrimary] = useState(personA);
  const [preview, setPreview] = useState(null);
  const [choices, setChoices] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const secondary = primary === personA ? personB : personA;
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    api.post(`/api/persons/${primary}/merge-preview`, { otherId: secondary })
      .then((p) => !cancelled && setPreview(p))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [primary, secondary]);
  const submit = async () => {
    setBusy(true);
    try {
      if (hypothesis) await save(() => api.post(`/api/hypotheses/${hypothesis.id}/confirm`, { primaryId: primary, choices }), { success: 'Записи объединены' });
      else await save(() => api.post(`/api/persons/${primary}/merge`, { otherId: secondary, choices }), { success: 'Записи объединены' });
      onMerged?.(primary);
      onClose();
    } catch (e) {
      reportError(ui, e);
    } finally {
      setBusy(false);
    }
  };
  const a = index.byId.get(personA);
  const b = index.byId.get(personB);
  return (
    <Modal
      title="Объединить записи одного человека"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !preview || preview.blockers.length > 0}>
            {busy && <Loader2 size={16} className="spin" />} Объединить
          </button>
        </>
      }
    >
      <p className="modal-text">Объединяйте только если уверены, что это один человек. Исходные ячейки Excel обеих записей сохранятся, второе имя станет вариантом написания.</p>
      <fieldset className="field">
        <legend className="field-label">Основная запись (её поля имеют приоритет)</legend>
        <div className="radio-cards">
          {[a, b].map((p) => (
            <label key={p.id} className={`radio-card ${primary === p.id ? 'is-active' : ''}`}>
              <input type="radio" name="primary" checked={primary === p.id} onChange={() => { setPrimary(p.id); setChoices({}); }} />
              <Avatar person={p} size={36} />
              <span><strong>{p.display_name}</strong><br /><span className="muted small">{(index.recordsByPerson.get(p.id) || []).map((r) => r.cell).join(', ') || 'добавлен вручную'}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p className="field-error">{error}</p>}
      {!preview && !error && <p className="muted"><Loader2 size={14} className="spin" /> Проверка последствий…</p>}
      {preview && (
        <div className="stack-16">
          {preview.blockers.map((t) => <Notice key={t} tone="danger" title="Объединение невозможно">{t}</Notice>)}
          {preview.conflicts.length > 0 && (
            <div>
              <h4 className="subhead">Разные значения — выберите, что оставить</h4>
              <table className="table compact">
                <thead><tr><th>Поле</th><th>Основная</th><th>Вторая</th></tr></thead>
                <tbody>
                  {preview.conflicts.map((c) => (
                    <tr key={c.field}>
                      <td>{c.label}</td>
                      <td><label className="radio-inline"><input type="radio" name={`c-${c.field}`} checked={choices[c.field] !== 'secondary'} onChange={() => setChoices({ ...choices, [c.field]: 'primary' })} /> {MERGE_VALUE(c.primary)}</label></td>
                      <td><label className="radio-inline"><input type="radio" name={`c-${c.field}`} checked={choices[c.field] === 'secondary'} onChange={() => setChoices({ ...choices, [c.field]: 'secondary' })} /> {MERGE_VALUE(c.secondary)}</label></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">
            Будет перенесено к основной записи: связей «родитель — ребёнок» — {preview.moves.parentChild}, партнёрств — {preview.moves.partnerships}, фотографий — {preview.moves.photos}, источников — {preview.moves.sources}, исходных записей — {preview.moves.sourceRecords}.
          </p>
        </div>
      )}
    </Modal>
  );
}

export function DeletePersonDialog({ personId, onClose, onDeleted }) {
  const { index, save } = useData();
  const ui = useUi();
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const person = index.byId.get(personId);
  useEffect(() => {
    api.get(`/api/persons/${personId}/delete-preview`).then(setPreview).catch((e) => setError(e.message));
  }, [personId]);
  const submit = async () => {
    setBusy(true);
    try {
      await save(() => api.del(`/api/persons/${personId}`), { success: 'Запись удалена' });
      onDeleted?.();
      onClose();
    } catch (e) {
      reportError(ui, e);
      setBusy(false);
    }
  };
  const REL = { parent: 'родитель', child: 'ребёнок', partner: 'партнёр' };
  return (
    <Modal
      title="Удалить человека?"
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={!preview || busy}>
            {busy && <Loader2 size={16} className="spin" />} Удалить безвозвратно
          </button>
        </>
      }
    >
      <p className="modal-lead">{person?.display_name}</p>
      {error && <p className="field-error">{error}</p>}
      {!preview && !error && <p className="muted"><Loader2 size={14} className="spin" /> Проверка последствий…</p>}
      {preview && (
        <ul className="notice-list is-danger">
          <li>Подтверждённых связей будет удалено: {preview.relations.length}{preview.relations.length ? ` (${preview.relations.map((r) => `${REL[r.type]}: ${r.person}`).join('; ')})` : ''}</li>
          <li>Фотографий: {preview.photos}, источников: {preview.sources}</li>
          <li>Предположений с участием человека: {preview.hypotheses}</li>
          {preview.sourceRecords.length > 0 && <li>Исходные записи Excel ({preview.sourceRecords.join(', ')}) останутся в истории импорта с отметкой «запись удалена» и не будут созданы заново при повторном импорте того же файла.</li>}
        </ul>
      )}
      <p className="muted small">Перед удалением можно создать резервную копию в разделе «Архив».</p>
    </Modal>
  );
}

// «Добавить человека» из верхней панели.
export function AddPersonDialog({ onClose, onCreated }) {
  const { save } = useData();
  const ui = useUi();
  const [names, setNames] = useState(emptyNames);
  const [sex, setSex] = useState('');
  const [life, setLife] = useState('unknown');
  const [birth, setBirth] = useState({ precision: 'unknown', date: null, dateEnd: null });
  const [link, setLink] = useState(null);
  const [linkType, setLinkType] = useState('child');
  const [pickLink, setPickLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const dups = useDuplicates(names);
  const hasName = !!(names.display_name || names.surname || names.given_name || names.patronymic).trim();
  const birthErr = dateFieldError('Дата рождения', birth);
  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        person: { ...names, sex: sex || null, life_status: life, birth_precision: birth.precision, birth_date: birth.date, birth_date_end: birth.dateEnd },
        relation: link ? { type: linkType, personId: link.id } : null,
      };
      const r = await save((force) => api.post('/api/persons', { ...body, force }), { success: 'Человек добавлен' });
      onCreated?.(r.person.id);
      onClose();
    } catch (e) {
      reportError(ui, e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Добавить человека"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!hasName || busy || !!birthErr}>
            {busy && <Loader2 size={16} className="spin" />} Добавить
          </button>
        </>
      }
    >
      <div className="stack-16">
        <NameFields value={names} onChange={setNames} idp="ap" />
        <DuplicateHint list={dups} onPick={(p) => { onCreated?.(p.id); onClose(); ui.toast(`Открыта существующая запись: ${p.display_name}`); }} />
        <div className="form-grid two">
          <Field label="Пол (необязательно)" htmlFor="ap-sex">
            <select id="ap-sex" className="input" value={sex} onChange={(e) => setSex(e.target.value)}>
              <option value="">Не указан</option>
              {Object.entries(SEX_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Жизненный статус" htmlFor="ap-life">
            <select id="ap-life" className="input" value={life} onChange={(e) => setLife(e.target.value)}>
              {Object.entries(LIFE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <DateField label="Дата рождения" value={birth} onChange={setBirth} />
        <div className="field">
          <span className="field-label">Связь с человеком из архива (необязательно)</span>
          {link ? (
            <div className="link-row">
              <select className="input" value={linkType} onChange={(e) => setLinkType(e.target.value)} aria-label="Кем приходится">
                <option value="child">Новый человек — ребёнок для</option>
                <option value="parent">Новый человек — родитель для</option>
                <option value="partner">Новый человек — партнёр для</option>
              </select>
              <span className="chip">{link.display_name}</span>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setLink(null)}>Убрать</button>
            </div>
          ) : pickLink ? (
            <PersonPicker onSelect={(p) => { setLink(p); setPickLink(false); }} />
          ) : (
            <button type="button" className="btn btn-outline" onClick={() => setPickLink(true)}><Link2 size={16} /> Выбрать человека</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// «Указать связь» в вопросе: любая связь между участниками (и не только).
export function SpecifyRelationDialog({ question, onClose }) {
  const { index, save } = useData();
  const ui = useUi();
  const people = [...question.subjects, ...question.candidates].filter((id) => index.byId.has(id));
  const [a, setA] = useState(people[0] || null);
  const [b, setB] = useState(people[1] || null);
  const [rel, setRel] = useState(question.kind === 'pair' ? 'partner' : 'parent');
  const [kind, setKind] = useState({ kind: 'unknown', status: 'unknown' });
  const [pickOther, setPickOther] = useState(false);
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState(false);
  if (merge) return <MergeDialog personA={a} personB={b} onClose={onClose} />;
  const submit = async () => {
    if (!a || !b || a === b) return;
    if (rel === 'same') {
      setMerge(true);
      return;
    }
    setBusy(true);
    try {
      if (rel === 'partner') await save((force) => api.post('/api/relations/partnerships', { person1Id: a, person2Id: b, kind: kind.kind, status: kind.status, force }), { success: 'Связь сохранена' });
      else {
        const [p, c] = rel === 'parent' ? [a, b] : [b, a];
        await save((force) => api.post('/api/relations/parent-child', { parentId: p, childId: c, kind: kind.kind, force }), { success: 'Связь сохранена' });
      }
      onClose();
    } catch (e) {
      reportError(ui, e);
    } finally {
      setBusy(false);
    }
  };
  const select = (val, on, id) => (
    <select id={id} className="input" value={val || ''} onChange={(e) => on(e.target.value)}>
      {people.map((pid) => <option key={pid} value={pid}>{index.byId.get(pid).display_name}</option>)}
      {val && !people.includes(val) && <option value={val}>{index.byId.get(val)?.display_name}</option>}
    </select>
  );
  return (
    <Modal
      title="Указать связь"
      onClose={onClose}
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !a || !b || a === b}>
            {busy && <Loader2 size={16} className="spin" />} {rel === 'same' ? 'Перейти к объединению' : 'Сохранить связь'}
          </button>
        </>
      }
    >
      <p className="muted">{question.title}</p>
      <div className="stack-16 mt-16">
        <Field label="Первый человек" htmlFor="sr-a">{select(a, setA, 'sr-a')}</Field>
        <Field label="Кем приходится" htmlFor="sr-rel">
          <select id="sr-rel" className="input" value={rel} onChange={(e) => setRel(e.target.value)}>
            <option value="parent">родитель второго человека</option>
            <option value="child">ребёнок второго человека</option>
            <option value="partner">партнёр / супруг(а) второго человека</option>
            <option value="same">это тот же человек (объединить записи)</option>
          </select>
        </Field>
        <Field label="Второй человек" htmlFor="sr-b">
          {select(b, setB, 'sr-b')}
          {!pickOther ? (
            <button type="button" className="btn btn-link" onClick={() => setPickOther(true)}>Выбрать другого человека из архива</button>
          ) : (
            <PersonPicker exclude={new Set([a])} onSelect={(p) => { setB(p.id); setPickOther(false); }} />
          )}
        </Field>
        {a === b && <p className="field-error">Нельзя связать человека с самим собой.</p>}
        {rel !== 'same' && <KindFields type={rel === 'partner' ? 'partner' : 'parent'} value={kind} onChange={setKind} />}
        <p className="muted small">Будет сохранена только указанная связь. Остальные предположения останутся вопросами.</p>
      </div>
    </Modal>
  );
}
