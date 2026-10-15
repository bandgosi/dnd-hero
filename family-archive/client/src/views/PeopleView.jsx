// «Все люди»: поиск, сортировка, фильтры, список или карточки.
import { useMemo, useState } from 'react';
import { Search, LayoutGrid, List, UserPlus, X } from 'lucide-react';
import { useData } from '../store.jsx';
import { Avatar, Segmented, EmptyState } from '../components/ui.jsx';
import { ViewHeader } from './TreeView.jsx';
import { lifeSpan, personSearchText, matchesQuery, birthOf, LIFE_LABELS, countText } from '../lib/format.js';
import { dateBounds } from '../../../shared/dates.js';

const FILTERS = [
  { key: 'noDates', label: 'Нет дат' },
  { key: 'noPhoto', label: 'Нет фото' },
  { key: 'noRelations', label: 'Без подтверждённых связей' },
  { key: 'questions', label: 'Есть открытые вопросы' },
  { key: 'draftName', label: 'Разбор ФИО не проверен' },
  { key: 'unknownStatus', label: 'Статус неизвестен' },
  { key: 'manual', label: 'Добавлены вручную' },
];

function personFlags(p, index) {
  const recs = index.recordsByPerson.get(p.id) || [];
  const hasRel = (index.parentsOf.get(p.id) || []).length + (index.childrenOf.get(p.id) || []).length + (index.partnersOf.get(p.id) || []).length > 0;
  const questions = (index.questionsByPerson.get(p.id) || []).filter((q) => q.status !== 'resolved').length;
  return {
    noDates: p.birth_precision === 'unknown' && p.death_precision === 'unknown',
    noPhoto: !p.primary_photo_id,
    noRelations: !hasRel,
    questions: questions > 0,
    questionCount: questions,
    draftName: p.name_fields_status === 'suggested',
    unknownStatus: p.life_status === 'unknown',
    manual: recs.length === 0,
    record: recs.find((r) => r.status === 'active') || recs[0],
  };
}

export function PeopleView({ selectedId, onSelect, onAddPerson, initialQuery = '' }) {
  const { data, index } = useData();
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState('name');
  const [filters, setFilters] = useState(new Set());
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem('fa_people_layout') || 'list';
    } catch {
      return 'list';
    }
  });
  const setLayoutSaved = (v) => {
    setLayout(v);
    try {
      localStorage.setItem('fa_people_layout', v);
    } catch {
      /* без сохранения настройки */
    }
  };
  const rows = useMemo(() => {
    const list = data.persons.map((p) => ({ p, f: personFlags(p, index), text: personSearchText(p, index.recordsByPerson.get(p.id) || []) }))
      .filter((x) => matchesQuery(x.text, query))
      .filter((x) => [...filters].every((k) => x.f[k]));
    const cmp = {
      name: (a, b) => a.p.display_name.localeCompare(b.p.display_name, 'ru'),
      surname: (a, b) => (a.p.surname || a.p.display_name).localeCompare(b.p.surname || b.p.display_name, 'ru') || a.p.display_name.localeCompare(b.p.display_name, 'ru'),
      cell: (a, b) => {
        const ra = a.f.record;
        const rb = b.f.record;
        if (!ra || !rb) return ra ? -1 : rb ? 1 : 0;
        return ra.sheet_name.localeCompare(rb.sheet_name) || ra.row_index - rb.row_index || ra.col_index - rb.col_index;
      },
      birth: (a, b) => {
        const ba = dateBounds(birthOf(a.p));
        const bb = dateBounds(birthOf(b.p));
        if (!ba || !bb) return ba ? -1 : bb ? 1 : a.p.display_name.localeCompare(b.p.display_name, 'ru');
        return ba.min - bb.min;
      },
      updated: (a, b) => (b.p.updated_at || '').localeCompare(a.p.updated_at || ''),
    }[sort];
    return list.sort(cmp);
  }, [data, index, query, filters, sort]);

  const toggle = (k) => setFilters((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  return (
    <section className="view view-people">
      <ViewHeader
        title="Все люди"
        subtitle={`${countText(data.persons.length, 'запись', 'записи', 'записей')} в архиве`}
        actions={<button type="button" className="btn btn-outline" onClick={onAddPerson}><UserPlus size={17} /> Добавить человека</button>}
      />
      <div className="people-toolbar">
        <label className="search-box grow">
          <Search size={18} aria-hidden="true" />
          <input className="input-bare" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, фамилия, вариант написания или ячейка (F6)" aria-label="Поиск по людям" />
          {query && <button type="button" className="icon-btn small" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={14} /></button>}
        </label>
        <label className="sort-select">
          <span className="visually-hidden">Сортировка</span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка">
            <option value="name">По имени (А–Я)</option>
            <option value="surname">По фамилии</option>
            <option value="cell">По ячейке Excel</option>
            <option value="birth">По дате рождения</option>
            <option value="updated">Недавно изменённые</option>
          </select>
        </label>
        <Segmented label="Вид" value={layout} onChange={setLayoutSaved} options={[{ value: 'list', label: 'Список', icon: <List size={16} /> }, { value: 'cards', label: 'Карточки', icon: <LayoutGrid size={16} /> }]} />
      </div>
      <div className="filter-row" role="group" aria-label="Фильтры">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`filter-chip ${filters.has(f.key) ? 'is-active' : ''}`} aria-pressed={filters.has(f.key)} onClick={() => toggle(f.key)}>{f.label}</button>
        ))}
        {filters.size > 0 && <button type="button" className="btn btn-link" onClick={() => setFilters(new Set())}>Сбросить</button>}
      </div>
      <p className="muted small" aria-live="polite">Показано {rows.length} из {data.persons.length}</p>
      {rows.length === 0 ? (
        <EmptyState title="Никого не найдено" text="Измените запрос или фильтры." />
      ) : layout === 'list' ? (
        <ul className="people-list">
          {rows.map(({ p, f }) => (
            <li key={p.id}>
              <button type="button" className={`people-row ${selectedId === p.id ? 'is-selected' : ''}`} onClick={() => onSelect(p.id)} aria-current={selectedId === p.id ? 'true' : undefined}>
                <Avatar person={p} size={44} />
                <span className="people-main">
                  <span className="people-name">{p.display_name}</span>
                  <span className="people-meta">{lifeSpan(p) || 'Даты не указаны'} · {LIFE_LABELS[p.life_status]}</span>
                </span>
                <span className="people-badges">
                  {f.record && <span className="chip chip-muted">{f.record.sheet_name}!{f.record.cell}</span>}
                  {f.manual && <span className="chip chip-muted">Вручную</span>}
                  {f.noRelations && <span className="chip chip-outline">Нет связей</span>}
                  {f.questionCount > 0 && <span className="chip chip-hyp">Вопросов: {f.questionCount}</span>}
                  {f.draftName && <span className="chip chip-outline">ФИО — черновик</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="people-grid">
          {rows.map(({ p, f }) => (
            <button key={p.id} type="button" className={`person-card ${selectedId === p.id ? 'is-selected' : ''}`} onClick={() => onSelect(p.id)}>
              <Avatar person={p} size={64} />
              <span className="people-name">{p.display_name}</span>
              <span className="people-meta">{lifeSpan(p) || 'Даты не указаны'}</span>
              <span className="people-badges center">
                {f.record && <span className="chip chip-muted">{f.record.cell}</span>}
                {f.noRelations && <span className="chip chip-outline">Нет связей</span>}
                {f.questionCount > 0 && <span className="chip chip-hyp">?{f.questionCount}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
