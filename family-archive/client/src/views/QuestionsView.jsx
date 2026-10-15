// «Уточнить связи»: очередь вопросов с предположениями и необязательная проверка написания.
import { useMemo, useState, useEffect } from 'react';
import { CheckCircle2, Clock, RotateCcw, Link2, Info, X, BookOpen, Check, Undo2 } from 'lucide-react';
import { api } from '../api.js';
import { useData, useUi, reportError } from '../store.jsx';
import { Avatar, Segmented, EmptyState, Notice } from '../components/ui.jsx';
import { ConfirmHypothesisDialog, SpecifyRelationDialog, describeHyp } from '../components/dialogs.jsx';
import { PersonPicker } from '../components/fields.jsx';
import { ViewHeader } from './TreeView.jsx';
import { Q_STATUS_LABELS, HYP_STATUS_LABELS, countText } from '../lib/format.js';

const KIND_LABELS = { pair: 'Кем приходятся друг другу', parents: 'Родители', same_person: 'Один или разные люди', custom: 'Вопрос' };
const STRENGTH_LABELS = { patronymic: 'по отчеству', position: 'по расположению', frame: 'по расположению и рамке', name: 'по совпадению имени' };

function PersonChip({ id, onSelect, role }) {
  const { index } = useData();
  const p = index.byId.get(id);
  if (!p) return null;
  const rec = index.recordsByPerson.get(id)?.find((r) => r.status === 'active');
  return (
    <button type="button" className={`person-chip ${role === 'candidate' ? 'is-candidate' : ''}`} onClick={() => onSelect(id)} title="Открыть карточку">
      <Avatar person={p} size={28} />
      <span>{p.display_name}</span>
      {rec && <span className="cell-tag">{rec.cell}</span>}
    </button>
  );
}

function HypothesisRow({ h, onConfirm }) {
  const { index, save } = useData();
  const ui = useUi();
  const d = describeHyp(h, index);
  const act = async (path, msg, confirmOpts) => {
    if (confirmOpts) {
      const ok = await ui.confirm(confirmOpts);
      if (!ok) return;
    }
    try {
      await save(() => api.post(`/api/hypotheses/${h.id}/${path}`, {}), { success: msg });
    } catch (e) {
      reportError(ui, e);
    }
  };
  return (
    <li className={`hyp-row status-${h.status}`}>
      <span className={`hyp-mark ${h.status === 'confirmed' ? 'is-ok' : h.status === 'rejected' ? 'is-no' : ''}`} aria-hidden="true">
        {h.status === 'confirmed' ? <Check size={14} /> : h.status === 'rejected' ? <X size={14} /> : '?'}
      </span>
      <div className="hyp-text">
        <div className="hyp-line">
          <span className="hyp-desc">{d.text}</span>
          <span className="chip chip-muted">{STRENGTH_LABELS[h.strength] || h.strength}</span>
          <span className={`status-tag tag-${h.status}`}>{HYP_STATUS_LABELS[h.status]}</span>
        </div>
        <details>
          <summary>Почему так предположено</summary>
          <ul className="basis-list">{h.basis.map((b, i) => <li key={i}>{b.text}</li>)}</ul>
        </details>
      </div>
      <div className="hyp-actions">
        {(h.status === 'open' || h.status === 'deferred') && (
          <>
            <button type="button" className="btn btn-small btn-primary" onClick={() => onConfirm(h)}>{h.type === 'same_person' ? 'Объединить…' : 'Подтвердить…'}</button>
            <button type="button" className="btn btn-small btn-outline" onClick={() => act('reject', 'Предположение отклонено')}>Отклонить</button>
          </>
        )}
        {h.status === 'confirmed' && (
          <button type="button" className="btn btn-small btn-ghost" onClick={() => act('reopen', 'Подтверждение отменено', { title: 'Исправить ошибочное подтверждение?', message: `Связь «${d.text}» будет удалена, предположение вернётся в очередь.`, confirmText: 'Отменить подтверждение', tone: 'warning' })}>
            <Undo2 size={14} /> Исправить
          </button>
        )}
        {h.status === 'rejected' && (
          <button type="button" className="btn btn-small btn-ghost" onClick={() => act('reopen', 'Предположение возвращено')}><RotateCcw size={14} /> Вернуть</button>
        )}
      </div>
    </li>
  );
}

function QuestionCard({ q, onSelect, highlight }) {
  const { index, save } = useData();
  const ui = useUi();
  const [confirmHyp, setConfirmHyp] = useState(null);
  const [specify, setSpecify] = useState(false);
  const hyps = q.hypothesisIds.map((id) => index.hypById.get(id)).filter(Boolean);
  const setStatus = async (status, msg) => {
    try {
      await save(() => api.post(`/api/questions/${q.id}/status`, { status }), { success: msg });
    } catch (e) {
      reportError(ui, e);
    }
  };
  const confirmedRels = hyps.filter((h) => h.status === 'confirmed').length;
  return (
    <article className={`question-card status-${q.status} ${highlight ? 'is-highlight' : ''}`} id={`q-${q.id}`}>
      <header className="question-head">
        <div className="chip-row">
          {q.family && <span className="chip chip-green">{q.family}</span>}
          <span className="chip chip-muted">{KIND_LABELS[q.kind]}</span>
          <span className={`status-tag tag-q-${q.status}`}>{Q_STATUS_LABELS[q.status]}</span>
        </div>
        <h3 className="question-title">{q.title}</h3>
        {q.prompt && <p className="question-prompt">{q.prompt}</p>}
        {q.notes?.length > 0 && (
          <ul className="question-notes">
            {q.notes.map((n, i) => <li key={i}><Info size={14} aria-hidden="true" /> {n}</li>)}
          </ul>
        )}
      </header>
      <div className="question-section">
        <h4 className="subhead">Исходные записи</h4>
        <div className="chip-row">
          {q.subjects.map((id) => <PersonChip key={id} id={id} onSelect={onSelect} />)}
          {q.candidates.map((id) => <PersonChip key={id} id={id} onSelect={onSelect} role="candidate" />)}
        </div>
      </div>
      {hyps.length > 0 && (
        <div className="question-section">
          <h4 className="subhead">Предположения {confirmedRels > 0 && <span className="muted small">· подтверждено {confirmedRels}</span>}</h4>
          <ul className="hyp-rows">{hyps.map((h) => <HypothesisRow key={h.id} h={h} onConfirm={setConfirmHyp} />)}</ul>
        </div>
      )}
      <footer className="question-actions">
        <button type="button" className="btn btn-primary" onClick={() => setSpecify(true)}><Link2 size={16} /> Указать связь</button>
        {q.status === 'open' && <button type="button" className="btn btn-outline" onClick={() => setStatus('deferred', 'Вопрос отложен')}><Clock size={16} /> Позже</button>}
        {q.status !== 'open' && <button type="button" className="btn btn-outline" onClick={() => setStatus('open', 'Вопрос возвращён в работу')}><RotateCcw size={16} /> Вернуть в работу</button>}
        {q.status !== 'resolved' && <button type="button" className="btn btn-ghost" onClick={() => setStatus('resolved', 'Вопрос отмечен решённым')}><CheckCircle2 size={16} /> Отметить решённым</button>}
      </footer>
      {confirmHyp && <ConfirmHypothesisDialog hypothesis={confirmHyp} onClose={() => setConfirmHyp(null)} />}
      {specify && <SpecifyRelationDialog question={q} onClose={() => setSpecify(false)} />}
    </article>
  );
}

function NameReviews({ onSelect, personFilter }) {
  const { data, index, save } = useData();
  const ui = useUi();
  const [status, setStatus] = useState('open');
  const list = data.nameReviews.filter((r) => (status === 'all' || r.status === status) && (!personFilter || r.person_ids.includes(personFilter)));
  const setReview = async (r, st, msg) => {
    try {
      await save(() => api.post(`/api/name-reviews/${r.id}/status`, { status: st }), { success: msg });
    } catch (e) {
      reportError(ui, e);
    }
  };
  const apply = async (r) => {
    const p = index.byId.get(r.person_ids[0]);
    const s = r.suggestion;
    if (!p || !s) return;
    const oldValue = p[s.field];
    const ok = await ui.confirm({
      title: 'Применить другое написание?',
      message: `«${oldValue}» → «${s.value}» в карточке «${p.display_name}». Исходная строка Excel не изменится, прежнее написание сохранится в «Других именах» и будет находиться поиском.`,
      confirmText: 'Применить',
    });
    if (!ok) return;
    try {
      const display = p.display_name.split(' ').map((t) => (t === oldValue ? s.value : t)).join(' ');
      const other = [...(p.other_names || [])];
      if (!other.includes(p.display_name) && display !== p.display_name) other.push(p.display_name);
      await save(async () => {
        await api.put(`/api/persons/${p.id}`, { person: { [s.field]: s.value, display_name: display, other_names: other } });
        await api.post(`/api/name-reviews/${r.id}/status`, { status: 'changed' });
      }, { success: 'Написание изменено' });
    } catch (e) {
      reportError(ui, e);
    }
  };
  const counts = { open: 0, kept: 0, changed: 0, dismissed: 0 };
  for (const r of data.nameReviews) counts[r.status] += 1;
  return (
    <div className="stack-16">
      <Notice tone="info" icon={<BookOpen size={20} />} title="Необязательная проверка">
        Здесь собраны возможные особенности написания. Ничего не исправляется автоматически: исходные строки Excel всегда сохраняются как есть.
      </Notice>
      <Segmented label="Статус" value={status} onChange={setStatus} options={[
        { value: 'open', label: 'Не просмотрено', count: counts.open },
        { value: 'kept', label: 'Как в источнике', count: counts.kept },
        { value: 'changed', label: 'Исправлено', count: counts.changed },
        { value: 'all', label: 'Все', count: data.nameReviews.length },
      ]} />
      {list.length === 0 && <EmptyState title="Здесь пусто" text="Нет задач проверки написания с таким статусом." />}
      {list.map((r) => (
        <article key={r.id} className="question-card">
          <p className="question-prompt">{r.message}</p>
          <div className="chip-row">{r.person_ids.map((id) => <PersonChip key={id} id={id} onSelect={onSelect} />)}</div>
          <footer className="question-actions">
            {r.status === 'open' ? (
              <>
                <button type="button" className="btn btn-outline" onClick={() => setReview(r, 'kept', 'Оставлено как в источнике')}>Оставить как в источнике</button>
                {r.suggestion && r.person_ids.length === 1 && <button type="button" className="btn btn-outline" onClick={() => apply(r)}>Применить «{r.suggestion.value}»</button>}
                <button type="button" className="btn btn-ghost" onClick={() => { onSelect(r.person_ids[0]); }}>Открыть карточку</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setReview(r, 'open', 'Возвращено в проверку')}><RotateCcw size={14} /> Вернуть</button>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}

export function QuestionsView({ params, onSelect, setParams }) {
  const { data, index } = useData();
  const tab = params.tab === 'names' ? 'names' : 'relations';
  const status = params.status || 'open';
  const family = params.family || '';
  const personFilter = params.person || '';
  const [pickPerson, setPickPerson] = useState(false);
  const families = [...new Set(data.questions.map((q) => q.family).filter(Boolean))];
  const counts = { open: 0, deferred: 0, resolved: 0 };
  for (const q of data.questions) counts[q.status] += 1;
  const list = useMemo(() => data.questions.filter((q) => (status === 'all' || q.status === status)
    && (!family || q.family === family)
    && (!personFilter || q.subjects.includes(personFilter) || q.candidates.includes(personFilter))), [data, status, family, personFilter]);
  useEffect(() => {
    if (params.q) document.getElementById(`q-${params.q}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [params.q, list.length]);
  const fp = personFilter ? index.byId.get(personFilter) : null;
  return (
    <section className="view view-questions">
      <ViewHeader title="Уточнить связи" subtitle="Предположения из исходного наброска. Ничего не становится фактом без вашего решения." />
      <Segmented label="Раздел" value={tab} onChange={(v) => setParams({ ...params, tab: v })} options={[
        { value: 'relations', label: 'Родственные связи', count: counts.open },
        { value: 'names', label: 'Написание имён (необязательно)', count: data.nameReviews.filter((r) => r.status === 'open').length },
      ]} />
      {tab === 'names' ? (
        <div className="mt-16"><NameReviews onSelect={onSelect} personFilter={personFilter} /></div>
      ) : (
        <>
          <p className="muted small mt-12">Каждое предположение подтверждается или отклоняется отдельно. Подтверждение одного родителя не назначает второго и не создаёт пару. Пол, даты и фамилии не определяются автоматически.</p>
          <div className="questions-toolbar">
            <Segmented label="Статус" value={status} onChange={(v) => setParams({ ...params, status: v })} options={[
              { value: 'open', label: 'Открытые', count: counts.open },
              { value: 'deferred', label: 'Отложенные', count: counts.deferred },
              { value: 'resolved', label: 'Решённые', count: counts.resolved },
              { value: 'all', label: 'Все', count: data.questions.length },
            ]} />
            {families.length > 1 && (
              <select className="input input-small" value={family} onChange={(e) => setParams({ ...params, family: e.target.value })} aria-label="Семья">
                <option value="">Все семьи</option>
                {families.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            )}
            {fp ? (
              <span className="chip chip-green chip-lg">Человек: {fp.display_name}
                <button type="button" className="chip-x" onClick={() => setParams({ ...params, person: '' })} aria-label="Сбросить фильтр по человеку"><X size={14} /></button>
              </span>
            ) : (
              <button type="button" className="btn btn-outline btn-small" onClick={() => setPickPerson((v) => !v)}>Фильтр по человеку</button>
            )}
          </div>
          {pickPerson && !fp && (
            <div className="picker-inline"><PersonPicker autoFocus onSelect={(p) => { setPickPerson(false); setParams({ ...params, person: p.id }); }} /></div>
          )}
          {data.questions.length === 0 ? (
            <EmptyState icon={<CheckCircle2 size={28} />} title="Вопросов нет" text="Вопросы появляются после импорта Excel. Связи можно указывать и вручную — в карточке человека, вкладка «Связи»." />
          ) : list.length === 0 ? (
            <EmptyState title={status === 'open' ? 'Открытых вопросов нет' : 'Ничего не найдено'} text={status === 'open' ? 'Можно посмотреть отложенные или решённые вопросы.' : 'Измените фильтры.'} />
          ) : (
            <div className="question-list">
              <p className="muted small" aria-live="polite">{countText(list.length, 'вопрос', 'вопроса', 'вопросов')}</p>
              {list.map((q) => <QuestionCard key={q.id} q={q} onSelect={onSelect} highlight={params.q === q.id} />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}
