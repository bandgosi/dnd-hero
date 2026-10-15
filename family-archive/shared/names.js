// Работа с именами: черновой разбор ФИО, нормализация для поиска,
// сравнение отчества с именем. Ничего здесь не исправляет исходное написание —
// функции только предлагают черновики и ключи для сравнения.

const PATRONYMIC_RE = /(ович|евич|ьевич|ич|овна|евна|ьевна|ична|инична)$/i;
const PATRONYMIC_TOKENS = new Set(['оглы', 'кызы', 'улы', 'гызы']);

// Кэш для повторяющихся строк: при разборе книги функции сравнения вызываются для каждой пары
// записей (тысячи × тысячи раз), а различных имён и отчеств немного.
function memo(fn, max = 20000) {
  const cache = new Map();
  return (s) => {
    const k = String(s ?? '');
    let v = cache.get(k);
    if (v === undefined) {
      v = fn(k);
      if (cache.size >= max) cache.clear();
      cache.set(k, v);
    }
    return v;
  };
}

export function normalizeSpaces(s) {
  return String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

// Ключ для сравнения: нижний регистр, ё→е, без повторяющихся букв
// (так «Геннадий» и «Генадий» находятся одним поиском), без знаков.
export const searchKey = memo((s) =>
  String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/(\p{L})\1+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim(),
);

export function looksLikePatronymic(token) {
  if (!token) return false;
  const t = token.toLowerCase();
  if (PATRONYMIC_TOKENS.has(t)) return true;
  return t.length > 4 && PATRONYMIC_RE.test(t);
}

// Черновой разбор строки ФИО. Возвращает предложение, которое пользователь
// может исправить. Неизвестные части остаются null.
export function parseFullName(text) {
  const tokens = normalizeSpaces(text).split(' ').filter(Boolean);
  const res = { surname: null, given_name: null, patronymic: null, confidence: 'draft', note: null };
  if (tokens.length === 0) {
    res.note = 'Пустое значение';
    return res;
  }
  if (tokens.length === 1) {
    res.given_name = tokens[0];
    res.note = 'Одно слово: фамилия и отчество неизвестны';
    return res;
  }
  if (tokens.length === 2) {
    if (looksLikePatronymic(tokens[1])) {
      res.given_name = tokens[0];
      res.patronymic = tokens[1];
      res.note = 'Похоже на «Имя Отчество»; фамилия неизвестна';
    } else {
      res.surname = tokens[0];
      res.given_name = tokens[1];
      res.note = 'Порядок «Фамилия Имя» предположен по образцу файла; отчество не указано';
    }
    return res;
  }
  if (tokens.length === 3 && looksLikePatronymic(tokens[2])) {
    res.surname = tokens[0];
    res.given_name = tokens[1];
    res.patronymic = tokens[2];
    return res;
  }
  if (tokens.length === 4 && PATRONYMIC_TOKENS.has(tokens[3].toLowerCase())) {
    res.surname = tokens[0];
    res.given_name = tokens[1];
    res.patronymic = `${tokens[2]} ${tokens[3]}`;
    return res;
  }
  res.confidence = 'unparsed';
  res.note = 'Не удалось уверенно разобрать на фамилию, имя и отчество';
  return res;
}

// Основа фамилии без родовых окончаний: «Петрова» → «петров».
export function surnameStem(surname) {
  if (!surname) return null;
  let s = searchKey(surname);
  s = s.replace(/(ова|ева|ёва|ина|ына)$/, (m) => m.slice(0, -1));
  s = s.replace(/ская$/, 'ский').replace(/цкая$/, 'цкий');
  return s;
}

// Основа отчества: «Сергеевич» → «серге», «Михайлович» → «михайл».
export const patronymicStem = memo((patronymic) => {
  if (!patronymic) return null;
  const s = searchKey(patronymic).split(' ')[0];
  const m = /(ьевич|ьевна|евич|евна|ович|овна|инична|ична|ич)$/.exec(s);
  if (!m) return null;
  return s.slice(0, s.length - m[1].length);
});

// Несколько известных нерегулярных форм отчеств.
const IRREGULAR = {
  михаил: ['михайл'],
  лев: ['льв'],
  павел: ['павл'],
  петр: ['петр'],
  илья: ['иль', 'ильин'],
  лука: ['лук'],
  фома: ['фом'],
  кузьма: ['кузьм'],
  никита: ['никит'],
  яков: ['яковл'],
  иаков: ['иаковл'],
  савва: ['сав', 'саввич'],
};

// Ключи имени, с которыми сравнивается основа отчества.
// Возвращаемый массив общий для кэша — не изменять.
export const givenNameKeys = memo((given) => {
  if (!given) return [];
  const g = searchKey(given).split(' ')[0];
  if (!g) return [];
  const keys = new Set([g]);
  const strip = g.replace(/(ий|ей|ай|ой|ь|й|а|я|е|и|о|у|ы)$/, '');
  if (strip && strip.length >= 2) keys.add(strip);
  for (const k of IRREGULAR[g] || []) keys.add(searchKey(k));
  // «Михаил» → «михайл»: и → й перед последней согласной в -аил/-уил.
  if (/[ау]ил$/.test(g)) keys.add(g.replace(/ил$/, 'йл'));
  return [...keys];
});

// Образовано ли отчество от данного имени (по основам, без учёта удвоенных букв).
export function patronymicMatchesName(patronymic, given) {
  const stem = patronymicStem(patronymic);
  if (!stem) return false;
  return givenNameKeys(given).includes(stem);
}

// Грамматический род отчества — только для проверки написания, не для поля «пол».
export function patronymicGenderForm(patronymic) {
  if (!patronymic) return null;
  const t = searchKey(patronymic);
  if (/(вна|чна|кызы|гызы)$/.test(t)) return 'f';
  if (/(вич|ич|оглы|улы)$/.test(t)) return 'm';
  return null;
}

export function surnameGenderForm(surname) {
  if (!surname) return null;
  const t = searchKey(surname);
  if (/(ова|ева|ина|ына|ская|цкая)$/.test(t)) return 'f';
  if (/(ов|ев|ин|ын|ский|цкий)$/.test(t)) return 'm';
  return null;
}

// Множественная форма фамилии для подписи группы: «Петров» → «Петровы».
export function familyLabel(surname) {
  if (!surname) return 'Без фамилии';
  const s = normalizeSpaces(surname);
  if (/(ова|ева|ина|ына)$/i.test(s)) return s.slice(0, -1) + 'ы';
  if (/(ов|ев|ин|ын)$/i.test(s)) return s + 'ы';
  if (/ская$/i.test(s)) return s.slice(0, -4) + 'ские';
  if (/ский$/i.test(s)) return s.slice(0, -4) + 'ские';
  return s;
}

export function initials(person) {
  const parts = [];
  if (person.surname) parts.push(person.surname);
  if (person.given_name) parts.push(person.given_name);
  if (parts.length === 0) parts.push(...normalizeSpaces(person.display_name).split(' ').slice(0, 2));
  return parts
    .filter(Boolean)
    .map((p) => p[0].toUpperCase())
    .join('')
    .slice(0, 2) || '?';
}

// Имена с удвоенными буквами в общепринятом написании — для необязательной
// проверки написания. Исходное написание при этом не меняется.
export const DOUBLE_LETTER_NAMES = [
  'Геннадий', 'Анна', 'Алла', 'Инна', 'Жанна', 'Элла', 'Эмма', 'Кирилл', 'Филипп', 'Савва',
  'Римма', 'Нонна', 'Белла', 'Изабелла', 'Стелла', 'Аполлон', 'Иннокентий', 'Ассоль', 'Владлен',
];

// Возвращает вероятное общепринятое написание или null.
export function doubleLetterSuggestion(token) {
  if (!token) return null;
  const key = searchKey(token);
  const lower = token.toLowerCase().replace(/ё/g, 'е');
  for (const name of DOUBLE_LETTER_NAMES) {
    const nk = searchKey(name);
    const nl = name.toLowerCase();
    if (key === nk && lower !== nl) return name;
    // Отчества: Геннадий → Геннадьевич / Геннадьевна и т. п.
    const stems = givenNameKeys(name).filter((k) => k !== nk);
    const base = nl.replace(/(ий|ей|ай|ь|й|а|я)$/, '');
    for (const suf of ['ьевич', 'ьевна', 'ович', 'овна', 'ич', 'ична']) {
      const form = base + suf;
      if (searchKey(form) === key && lower !== form && stems.length) {
        return form[0].toUpperCase() + form.slice(1);
      }
    }
  }
  return null;
}
