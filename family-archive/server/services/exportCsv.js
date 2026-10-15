// Экспорт людей и связей в CSV (UTF-8 с BOM, разделитель «;» — открывается в Excel).
// Неизвестные значения — пустые ячейки, точность даты — отдельный столбец,
// исходные строки Excel сохраняются полностью (в кавычках, с пробелами).
import { csvCell, parseJson } from '../lib/util.js';

const BOM = '﻿';
const line = (cells) => cells.map(csvCell).join(';');

export function personsCsv(db) {
  const persons = db.all('SELECT * FROM persons ORDER BY display_name');
  const recs = db.all("SELECT person_id, file_name, sheet_name, cell, merged_range, raw_text FROM source_records WHERE status = 'active' AND person_id IS NOT NULL");
  const byPerson = new Map();
  for (const r of recs) {
    if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, []);
    byPerson.get(r.person_id).push(r);
  }
  const header = [
    'id', 'отображаемое_имя', 'фамилия', 'имя', 'отчество', 'фамилия_при_рождении', 'другие_имена', 'пол', 'жизненный_статус',
    'рождение_точность', 'рождение_дата', 'рождение_конец_диапазона', 'рождение_пояснение', 'место_рождения',
    'смерть_точность', 'смерть_дата', 'смерть_конец_диапазона', 'смерть_пояснение', 'место_смерти',
    'разбор_фио', 'исходные_ячейки', 'исходный_текст', 'создано', 'изменено',
  ];
  const rows = [line(header)];
  for (const p of persons) {
    const srs = byPerson.get(p.id) || [];
    rows.push(line([
      p.id, p.display_name, p.surname, p.given_name, p.patronymic, p.birth_surname, parseJson(p.other_names, []).join(' | '), p.sex, p.life_status,
      p.birth_precision, p.birth_date, p.birth_date_end, p.birth_date_note, p.birth_place,
      p.death_precision, p.death_date, p.death_date_end, p.death_date_note, p.death_place,
      p.name_fields_status,
      srs.map((r) => `${r.sheet_name}!${r.cell}${r.merged_range ? ` (${r.merged_range})` : ''}`).join(' | '),
      srs.map((r) => r.raw_text).join(' | '),
      p.created_at, p.updated_at,
    ]));
  }
  return BOM + rows.join('\r\n') + '\r\n';
}

export function relationsCsv(db) {
  const name = new Map(db.all('SELECT id, display_name FROM persons').map((p) => [p.id, p.display_name]));
  const header = ['id', 'вид_связи', 'человек_1_id', 'человек_1', 'роль_1', 'человек_2_id', 'человек_2', 'роль_2', 'тип', 'статус',
    'начало_точность', 'начало_дата', 'начало_конец', 'окончание_точность', 'окончание_дата', 'окончание_конец', 'заметки', 'происхождение', 'создано'];
  const rows = [line(header)];
  for (const r of db.all('SELECT * FROM parent_child ORDER BY created_at')) {
    rows.push(line([r.id, 'родитель-ребёнок', r.parent_id, name.get(r.parent_id), 'родитель', r.child_id, name.get(r.child_id), 'ребёнок', r.kind, '', '', '', '', '', '', '', [r.kind_note, r.notes].filter(Boolean).join(' — '), r.origin, r.created_at]));
  }
  for (const r of db.all('SELECT * FROM partnerships ORDER BY created_at')) {
    rows.push(line([r.id, 'партнёрство', r.person1_id, name.get(r.person1_id), 'партнёр', r.person2_id, name.get(r.person2_id), 'партнёр', r.kind, r.status,
      r.start_precision, r.start_date, r.start_date_end, r.end_precision, r.end_date, r.end_date_end, r.notes, r.origin, r.created_at]));
  }
  return BOM + rows.join('\r\n') + '\r\n';
}
