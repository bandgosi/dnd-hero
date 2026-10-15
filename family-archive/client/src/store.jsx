// Состояние приложения: данные с сервера, производные индексы, статус сохранения,
// уведомления и диалоги подтверждения.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api.js';

const DataCtx = createContext(null);
const UiCtx = createContext(null);

function buildIndex(data) {
  const byId = new Map(data.persons.map((p) => [p.id, p]));
  const photosById = new Map(data.photos.map((p) => [p.id, p]));
  const photosByPerson = new Map();
  for (const ph of data.photos) {
    if (!photosByPerson.has(ph.person_id)) photosByPerson.set(ph.person_id, []);
    photosByPerson.get(ph.person_id).push(ph);
  }
  const parentsOf = new Map();
  const childrenOf = new Map();
  for (const r of data.parentChild) {
    if (!parentsOf.has(r.child_id)) parentsOf.set(r.child_id, []);
    parentsOf.get(r.child_id).push(r);
    if (!childrenOf.has(r.parent_id)) childrenOf.set(r.parent_id, []);
    childrenOf.get(r.parent_id).push(r);
  }
  const partnersOf = new Map();
  for (const r of data.partnerships) {
    for (const pid of [r.person1_id, r.person2_id]) {
      if (!partnersOf.has(pid)) partnersOf.set(pid, []);
      partnersOf.get(pid).push(r);
    }
  }
  const recordsByPerson = new Map();
  for (const r of data.sourceRecords) {
    if (!recordsByPerson.has(r.person_id)) recordsByPerson.set(r.person_id, []);
    recordsByPerson.get(r.person_id).push(r);
  }
  for (const list of recordsByPerson.values()) list.sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || a.row_index - b.row_index || a.col_index - b.col_index);
  const hypsByPerson = new Map();
  for (const h of data.hypotheses) {
    for (const pid of [h.person_a, h.person_b]) {
      if (!hypsByPerson.has(pid)) hypsByPerson.set(pid, []);
      hypsByPerson.get(pid).push(h);
    }
  }
  const hypById = new Map(data.hypotheses.map((h) => [h.id, h]));
  const questionsByPerson = new Map();
  for (const q of data.questions) {
    for (const pid of [...q.subjects, ...q.candidates]) {
      if (!questionsByPerson.has(pid)) questionsByPerson.set(pid, []);
      questionsByPerson.get(pid).push(q);
    }
  }
  const sourcesByPerson = new Map();
  for (const s of data.sources) {
    if (!sourcesByPerson.has(s.person_id)) sourcesByPerson.set(s.person_id, []);
    sourcesByPerson.get(s.person_id).push(s);
  }
  const reviewsByPerson = new Map();
  for (const r of data.nameReviews) for (const pid of r.person_ids) {
    if (!reviewsByPerson.has(pid)) reviewsByPerson.set(pid, []);
    reviewsByPerson.get(pid).push(r);
  }
  return { byId, photosById, photosByPerson, parentsOf, childrenOf, partnersOf, recordsByPerson, hypsByPerson, hypById, questionsByPerson, sourcesByPerson, reviewsByPerson };
}

export function DataProvider({ children }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [saveState, setSaveState] = useState({ status: 'idle' });
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const savedTimer = useRef(null);

  const reload = useCallback(async () => {
    try {
      const d = await api.get('/api/data');
      setData(d);
      setLoadError(null);
      return d;
    } catch (e) {
      setLoadError(e);
      throw e;
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  const toast = useCallback((text, kind = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  // Диалог подтверждения, возвращающий Promise<boolean>.
  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...opts, resolve: (v) => { setDialog(null); resolve(v); } });
  }), []);

  // Выполнить изменение: «Сохранение…» → запись на сервере → обновление данных → «Сохранено».
  // Если сервер вернул предупреждения (409), спросить пользователя и повторить с force.
  const save = useCallback(async (makeRequest, { success, reload: doReload = true } = {}) => {
    const run = async (force) => {
      setSaveState({ status: 'saving' });
      clearTimeout(savedTimer.current);
      try {
        const r = await makeRequest(force);
        if (doReload) await reload();
        setSaveState({ status: 'saved', at: Date.now() });
        savedTimer.current = setTimeout(() => setSaveState((s) => (s.status === 'saved' ? { status: 'idle', at: s.at } : s)), 6000);
        if (success) toast(success);
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && e.data?.needsConfirmation && !force) {
          setSaveState({ status: 'idle' });
          const ok = await confirm({
            title: 'Проверьте сведения',
            message: 'Сведения выглядят противоречиво. Их можно сохранить как есть — исходные данные не изменятся.',
            items: e.data.warnings,
            confirmText: 'Сохранить всё равно',
            tone: 'warning',
          });
          if (ok) return run(true);
          const cancel = new ApiError('Сохранение отменено', 499);
          cancel.cancelled = true;
          throw cancel;
        }
        setSaveState({ status: 'error', message: e.message, retry: () => run(force).catch(() => {}) });
        throw e;
      }
    };
    return run(false);
  }, [reload, toast, confirm]);

  const index = useMemo(() => (data ? buildIndex(data) : null), [data]);
  const value = useMemo(() => ({ data, index, reload, loadError, save, saveState, setSaveState }), [data, index, reload, loadError, save, saveState]);
  const ui = useMemo(() => ({ toast, toasts, confirm, dialog, setToasts }), [toast, toasts, confirm, dialog]);
  return (
    <DataCtx.Provider value={value}>
      <UiCtx.Provider value={ui}>{children}</UiCtx.Provider>
    </DataCtx.Provider>
  );
}

export const useData = () => useContext(DataCtx);
export const useUi = () => useContext(UiCtx);

// Ошибку показываем уведомлением, отменённое пользователем — молча.
export function reportError(ui, e) {
  if (e?.cancelled) return;
  ui.toast(e?.message || 'Не удалось выполнить действие', 'error');
}
