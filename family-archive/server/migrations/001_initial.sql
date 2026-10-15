-- Схема семейного архива, версия 1.
-- Неизвестные значения хранятся как NULL (или 'unknown' для перечислений) и
-- никогда не подменяются догадками.

CREATE TABLE persons (
  id                 TEXT PRIMARY KEY,
  display_name       TEXT NOT NULL,
  surname            TEXT,
  given_name         TEXT,
  patronymic         TEXT,
  birth_surname      TEXT,
  other_names        TEXT NOT NULL DEFAULT '[]',          -- JSON-массив строк
  name_fields_status TEXT NOT NULL DEFAULT 'manual'
                     CHECK (name_fields_status IN ('suggested', 'confirmed', 'manual')),
  sex                TEXT CHECK (sex IS NULL OR sex IN ('male', 'female', 'other')),  -- NULL = не указан
  life_status        TEXT NOT NULL DEFAULT 'unknown' CHECK (life_status IN ('unknown', 'alive', 'deceased')),
  birth_precision    TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (birth_precision IN ('unknown', 'exact', 'month', 'year', 'about', 'range')),
  birth_date         TEXT,
  birth_date_end     TEXT,
  birth_date_note    TEXT,
  death_precision    TEXT NOT NULL DEFAULT 'unknown'
                     CHECK (death_precision IN ('unknown', 'exact', 'month', 'year', 'about', 'range')),
  death_date         TEXT,
  death_date_end     TEXT,
  death_date_note    TEXT,
  birth_place        TEXT,
  death_place        TEXT,
  biography          TEXT,
  notes              TEXT,
  primary_photo_id   TEXT,
  origin             TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'import')),
  last_manual_edit_at TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- Родитель — ребёнок. Существует независимо от партнёрства родителей.
CREATE TABLE parent_child (
  id            TEXT PRIMARY KEY,
  parent_id     TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  child_id      TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'unknown'
                CHECK (kind IN ('unknown', 'biological', 'adoptive', 'foster', 'step', 'guardian', 'other')),
  kind_note     TEXT,
  notes         TEXT,
  origin        TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'hypothesis', 'import')),
  hypothesis_id TEXT,
  import_id     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (parent_id <> child_id),
  UNIQUE (parent_id, child_id)
);
CREATE INDEX idx_pc_child ON parent_child(child_id);

-- Партнёрства. Допускается несколько партнёрств у одного человека.
CREATE TABLE partnerships (
  id              TEXT PRIMARY KEY,
  person1_id      TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  person2_id      TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (kind IN ('unknown', 'marriage', 'civil', 'partners', 'engagement', 'other')),
  status          TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (status IN ('unknown', 'ongoing', 'divorced', 'separated', 'widowed', 'ended')),
  start_precision TEXT NOT NULL DEFAULT 'unknown',
  start_date      TEXT,
  start_date_end  TEXT,
  end_precision   TEXT NOT NULL DEFAULT 'unknown',
  end_date        TEXT,
  end_date_end    TEXT,
  notes           TEXT,
  origin          TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'hypothesis', 'import')),
  hypothesis_id   TEXT,
  import_id       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (person1_id <> person2_id)
);
CREATE INDEX idx_part_p1 ON partnerships(person1_id);
CREATE INDEX idx_part_p2 ON partnerships(person2_id);

-- Фотографии: файлы лежат в каталоге data/photos/<id>/.
CREATE TABLE photos (
  id              TEXT PRIMARY KEY,
  person_id       TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  original_file   TEXT NOT NULL,
  original_name   TEXT,
  original_mime   TEXT NOT NULL,
  original_size   INTEGER NOT NULL,
  original_width  INTEGER,
  original_height INTEGER,
  display_file    TEXT NOT NULL,
  display_width   INTEGER,
  display_height  INTEGER,
  thumb_file      TEXT NOT NULL,
  crop            TEXT,                -- JSON {x,y,w,h} в пикселях исходника
  caption         TEXT,
  sha256          TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX idx_photos_person ON photos(person_id);

-- Источники сведений, добавленные пользователем.
CREATE TABLE sources (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'other'
             CHECK (kind IN ('document', 'oral', 'photo', 'archive', 'web', 'excel', 'other')),
  details    TEXT,
  url        TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_sources_person ON sources(person_id);

-- Импорты Excel.
CREATE TABLE imports (
  id             TEXT PRIMARY KEY,
  file_name      TEXT NOT NULL,
  file_name_key  TEXT NOT NULL,
  checksum       TEXT NOT NULL,
  file_size      INTEGER NOT NULL,
  stored_file    TEXT,
  mode           TEXT NOT NULL CHECK (mode IN ('new', 'update')),
  previous_import_id TEXT,
  status         TEXT NOT NULL CHECK (status IN ('completed', 'rolled_back')),
  summary        TEXT NOT NULL DEFAULT '{}',   -- JSON: количества, проверки
  geometry       TEXT NOT NULL DEFAULT '{}',   -- JSON: столбцы, строки, объединения, границы, рамки
  applied_changes TEXT NOT NULL DEFAULT '[]',  -- JSON: изменения существующих людей (для отката)
  created_at     TEXT NOT NULL,
  rolled_back_at TEXT,
  rollback_summary TEXT
);
CREATE INDEX idx_imports_checksum ON imports(checksum);

-- Исходные записи (ячейки Excel) и их связь с людьми.
CREATE TABLE source_records (
  id           TEXT PRIMARY KEY,
  import_id    TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  person_id    TEXT REFERENCES persons(id) ON DELETE SET NULL,
  file_name    TEXT NOT NULL,
  checksum     TEXT NOT NULL,
  sheet_name   TEXT NOT NULL,
  cell         TEXT NOT NULL,
  row_index    INTEGER NOT NULL,
  col_index    INTEGER NOT NULL,
  merged_range TEXT,
  raw_text     TEXT NOT NULL,      -- полная исходная строка, включая пробелы
  parsed       TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'superseded', 'removed', 'person_deleted', 'rolled_back', 'skipped')),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_sr_person ON source_records(person_id);
CREATE INDEX idx_sr_import ON source_records(import_id);

-- Вопросы для уточнения.
CREATE TABLE questions (
  id          TEXT PRIMARY KEY,
  import_id   TEXT REFERENCES imports(id) ON DELETE CASCADE,
  key         TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('pair', 'parents', 'same_person', 'custom')),
  family      TEXT,
  title       TEXT NOT NULL,
  prompt      TEXT,
  notes       TEXT NOT NULL DEFAULT '[]',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'deferred', 'resolved')),
  status_note TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE question_persons (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  person_id   TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'subject' CHECK (role IN ('subject', 'candidate')),
  position    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, person_id)
);

-- Предположения (гипотезы). Не участвуют в вычислении родства.
CREATE TABLE hypotheses (
  id            TEXT PRIMARY KEY,
  question_id   TEXT REFERENCES questions(id) ON DELETE SET NULL,
  import_id     TEXT REFERENCES imports(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('parent_child', 'partnership', 'same_person')),
  person_a      TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,  -- для parent_child — родитель
  person_b      TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,  -- для parent_child — ребёнок
  strength      TEXT NOT NULL DEFAULT 'position',
  basis         TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'rejected', 'deferred')),
  relation_id   TEXT,
  decided_at    TEXT,
  decision_note TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (person_a <> person_b)
);
CREATE INDEX idx_hyp_a ON hypotheses(person_a);
CREATE INDEX idx_hyp_b ON hypotheses(person_b);

-- Необязательная проверка написания имён.
CREATE TABLE name_reviews (
  id         TEXT PRIMARY KEY,
  import_id  TEXT REFERENCES imports(id) ON DELETE CASCADE,
  key        TEXT NOT NULL UNIQUE,
  code       TEXT NOT NULL,
  person_ids TEXT NOT NULL DEFAULT '[]',
  message    TEXT NOT NULL,
  suggestion TEXT,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept', 'changed', 'dismissed')),
  created_at TEXT NOT NULL,
  decided_at TEXT
);

-- История изменений.
CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('user', 'import', 'system')),
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  summary     TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE change_log_persons (
  log_id    INTEGER NOT NULL REFERENCES change_log(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL,
  PRIMARY KEY (log_id, person_id)
);
CREATE INDEX idx_clp_person ON change_log_persons(person_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
