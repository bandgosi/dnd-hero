// Поля форм: дата с точностью, выбор существующего человека.
import { useMemo, useState, useId } from 'react';
import { Search } from 'lucide-react';
import { PRECISION_LABELS, validateDateValue } from '../../../shared/dates.js';
import { useData } from '../store.jsx';
import { Avatar } from './ui.jsx';
import { lifeSpan, personSearchText, matchesQuery } from '../lib/format.js';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

function splitDate(s) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s || '');
  if (!m) return { y: '', m: '', d: '' };
  return { y: m[1] || '', m: m[2] ? String(Number(m[2])) : '', d: m[3] ? String(Number(m[3])) : '' };
}

const pad = (v) => String(v).padStart(2, '0');

// Сборка строки только из введённых частей; недостающие день и месяц не подставляются.
function composeValue(precision, p) {
  const y = /^\d{4}$/.test(p.y) ? p.y : null;
  const y2 = /^\d{4}$/.test(p.y2) ? p.y2 : null;
  switch (precision) {
    case 'exact':
      return { date: y && p.m && p.d ? `${y}-${pad(p.m)}-${pad(p.d)}` : null, dateEnd: null };
    case 'month':
      return { date: y && p.m ? `${y}-${pad(p.m)}` : null, dateEnd: null };
    case 'year':
      return { date: y, dateEnd: null };
    case 'about':
      return { date: y ? (p.m ? `${y}-${pad(p.m)}` : y) : null, dateEnd: null };
    case 'range':
      return { date: y ? (p.m ? `${y}-${pad(p.m)}` : y) : null, dateEnd: y2 ? (p.m2 ? `${y2}-${pad(p.m2)}` : y2) : null };
    default:
      return { date: null, dateEnd: null };
  }
}

export function dateFieldError(label, value) {
  if (!value || value.precision === 'unknown') return null;
  if (value.incomplete) return value.precision === 'exact' ? 'Для полной даты заполните день, месяц и год' : value.precision === 'month' ? 'Укажите месяц и год' : 'Укажите год (четыре цифры)';
  const e = validateDateValue({ precision: value.precision, date: value.date || null, dateEnd: value.dateEnd || null }, label);
  return e ? e.replace(`${label}: `, '') : null;
}

export function DateField({ label, value, onChange, idPrefix }) {
  const auto = useId();
  const pid = idPrefix || auto;
  const precision = value?.precision || 'unknown';
  const [parts, setParts] = useState(() => {
    const a = splitDate(value?.date);
    const b = splitDate(value?.dateEnd);
    return { y: a.y, m: a.m, d: a.d, y2: b.y, m2: b.m };
  });
  const emit = (prec, p) => {
    const v = composeValue(prec, p);
    const incomplete = prec !== 'unknown' && (!v.date || (prec === 'range' && !v.dateEnd));
    onChange({ precision: prec, ...v, incomplete });
  };
  const update = (patch) => {
    const p = { ...parts, ...patch };
    setParts(p);
    emit(precision, p);
  };
  const setPrecision = (prec) => emit(prec, parts);
  const err = dateFieldError(label, value);
  const yearInput = (key, aria) => (
    <input
      key={key}
      className="input input-year"
      inputMode="numeric"
      maxLength={4}
      placeholder="гггг"
      aria-label={aria}
      value={parts[key]}
      onChange={(e) => update({ [key]: e.target.value.replace(/\D/g, '').slice(0, 4) })}
    />
  );
  const monthSelect = (key, optional, aria) => (
    <select className="input input-month" value={parts[key]} onChange={(e) => update({ [key]: e.target.value })} aria-label={aria}>
      <option value="">{optional ? 'месяц не известен' : 'месяц'}</option>
      {MONTHS.map((m, i) => (
        <option key={m} value={String(i + 1)}>
          {m}
        </option>
      ))}
    </select>
  );
  return (
    <fieldset className={`field date-field ${err ? 'has-error' : ''}`}>
      <legend className="field-label">{label}</legend>
      <div className="date-row">
        <select id={`${pid}-precision`} className="input input-precision" value={precision} onChange={(e) => setPrecision(e.target.value)} aria-label={`${label}: точность`}>
          {Object.entries(PRECISION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {precision === 'exact' && (
          <>
            <input className="input input-day" inputMode="numeric" maxLength={2} placeholder="дд" aria-label={`${label}: день`} value={parts.d} onChange={(e) => update({ d: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
            {monthSelect('m', false, `${label}: месяц`)}
            {yearInput('y', `${label}: год`)}
          </>
        )}
        {precision === 'month' && (
          <>
            {monthSelect('m', false, `${label}: месяц`)}
            {yearInput('y', `${label}: год`)}
          </>
        )}
        {precision === 'year' && yearInput('y', `${label}: год`)}
        {precision === 'about' && (
          <>
            <span className="date-word">около</span>
            {monthSelect('m', true, `${label}: месяц (необязательно)`)}
            {yearInput('y', `${label}: год`)}
          </>
        )}
        {precision === 'range' && (
          <>
            <span className="date-word">с</span>
            {monthSelect('m', true, `${label}: начало, месяц`)}
            {yearInput('y', `${label}: начало, год`)}
            <span className="date-word">по</span>
            {monthSelect('m2', true, `${label}: конец, месяц`)}
            {yearInput('y2', `${label}: конец, год`)}
          </>
        )}
      </div>
      {precision === 'unknown' && <span className="field-hint">Дата неизвестна — ничего не подставляется.</span>}
      {err && <span className="field-error" role="alert">{err}</span>}
    </fieldset>
  );
}

// Выбор существующего человека (вместо создания дубля).
export function PersonPicker({ onSelect, exclude = new Set(), disabledReason, selectedId, autoFocus, placeholder = 'Найти по имени, фамилии или ячейке…', initialQuery = '' }) {
  const { data, index } = useData();
  const [q, setQ] = useState(initialQuery);
  const list = useMemo(() => {
    const items = data.persons
      .filter((p) => !exclude.has(p.id))
      .map((p) => ({ p, text: personSearchText(p, index.recordsByPerson.get(p.id) || []) }))
      .filter((x) => matchesQuery(x.text, q))
      .map((x) => x.p);
    return items.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ru')).slice(0, 80);
  }, [data, index, q, exclude]);
  return (
    <div className="picker">
      <label className="search-box">
        <Search size={18} aria-hidden="true" />
        <input className="input-bare" value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Поиск человека" />
      </label>
      <div className="picker-list" role="listbox" aria-label="Люди">
        {list.length === 0 && <p className="muted pad">Никого не найдено.</p>}
        {list.map((p) => {
          const reason = disabledReason?.(p.id);
          const rec = index.recordsByPerson.get(p.id)?.[0];
          return (
            <button key={p.id} type="button" role="option" aria-selected={selectedId === p.id} className={`picker-item ${selectedId === p.id ? 'is-selected' : ''}`} disabled={!!reason} onClick={() => onSelect(p)} title={reason || undefined}>
              <Avatar person={p} size={36} />
              <span className="picker-text">
                <span className="picker-name">{p.display_name}</span>
                <span className="picker-meta">
                  {[lifeSpan(p), rec ? `${rec.sheet_name}!${rec.cell}` : null, reason].filter(Boolean).join(' · ') || 'Даты не указаны'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
