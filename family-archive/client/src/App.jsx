// Оболочка приложения: верхняя панель, навигация, центральная область, карточка человека.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Network, Users, HelpCircle, FileSpreadsheet, Archive, Menu as MenuIcon, X, Database, Lock, Loader2, RotateCcw, LogOut } from 'lucide-react';
import { DataProvider, useData } from './store.jsx';
import { useRoute } from './router.js';
import { api } from './api.js';
import { ConfirmHost, Toasts, SaveStatus, Avatar, Spinner } from './components/ui.jsx';
import { AddPersonDialog } from './components/dialogs.jsx';
import { PersonPanel } from './components/PersonPanel.jsx';
import { TreeView } from './views/TreeView.jsx';
import { PeopleView } from './views/PeopleView.jsx';
import { QuestionsView } from './views/QuestionsView.jsx';
import { ImportView } from './views/ImportView.jsx';
import { ArchiveView } from './views/ArchiveView.jsx';
import { personSearchText, matchesQuery, lifeSpan, countText } from './lib/format.js';
import logoUrl from './assets/logo.webp';

function useMedia(query) {
  const [m, setM] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

const lsGet = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* настройка не сохранится — не критично */
  }
};

// Логотип: древо в золотой рамке (картинка 384×384 с прозрачными углами — чёткая и на экране входа на телефонах с плотностью 3x).
export function BrandMark({ size = 44 }) {
  return <img className="brand-mark" src={logoUrl} width={size} height={size} alt="" decoding="async" draggable="false" />;
}

function GlobalSearch({ onPick, onShowAll }) {
  const { data, index } = useData();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const results = useMemo(() => {
    if (!q.trim()) return [];
    return data.persons.filter((p) => matchesQuery(personSearchText(p, index.recordsByPerson.get(p.id) || []), q)).slice(0, 8);
  }, [q, data, index]);
  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (p) => {
    onPick(p.id);
    setQ('');
    setOpen(false);
  };
  return (
    <div className="global-search" ref={ref}>
      <label className="search-box">
        <Search size={18} aria-hidden="true" />
        <input
          className="input-bare"
          value={q}
          placeholder="Найти человека"
          aria-label="Найти человека"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="global-search-list"
          aria-autocomplete="list"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter' && results[active]) pick(results[active]);
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </label>
      {open && q.trim() && (
        <div className="search-results" id="global-search-list" role="listbox">
          {results.length === 0 && <p className="muted pad small">Никого не найдено. Поиск учитывает варианты написания и ячейки (например, F6).</p>}
          {results.map((p, i) => {
            const rec = index.recordsByPerson.get(p.id)?.[0];
            return (
              <button key={p.id} type="button" role="option" aria-selected={i === active} className={`search-item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(p)}>
                <Avatar person={p} size={30} />
                <span className="picker-text">
                  <span className="picker-name">{p.display_name}</span>
                  <span className="picker-meta">{[lifeSpan(p), rec?.cell].filter(Boolean).join(' · ') || 'Даты не указаны'}</span>
                </span>
              </button>
            );
          })}
          {results.length > 0 && <button type="button" className="search-all" onClick={() => { onShowAll(q); setOpen(false); }}>Все результаты в списке людей</button>}
        </div>
      )}
    </div>
  );
}

function Sidebar({ view, go, onPick, onShowAll, open, onClose, isPhone }) {
  const { data } = useData();
  const openQuestions = data.questions.filter((q) => q.status === 'open').length;
  const excelCount = data.sourceRecords.filter((r) => r.status === 'active').length;
  const item = (key, icon, label, extra) => (
    <button type="button" className={`nav-item ${view === key ? 'is-active' : ''}`} aria-current={view === key ? 'page' : undefined} onClick={() => { go(key); onClose(); }}>
      {icon}
      <span className="nav-label">{label}</span>
      {extra}
    </button>
  );
  return (
    <>
      {isPhone && open && <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />}
      <nav className={`sidebar ${isPhone ? 'is-drawer' : ''} ${open ? 'is-open' : ''}`} aria-label="Основная навигация">
        {isPhone && (
          <div className="drawer-head">
            <span className="h3">Меню</span>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть меню"><X size={20} /></button>
          </div>
        )}
        <GlobalSearch onPick={(id) => { onPick(id); onClose(); }} onShowAll={(q) => { onShowAll(q); onClose(); }} />
        <div className="nav-list">
          {item('tree', <Network size={21} />, 'Семейное древо')}
          {item('people', <Users size={21} />, `Все люди · ${data.persons.length}`)}
          {item('questions', <HelpCircle size={21} />, 'Уточнить связи', openQuestions > 0 && <span className="nav-badge" aria-label={`${openQuestions} открытых`}>{openQuestions}</span>)}
          {item('import', <FileSpreadsheet size={21} />, 'Импорт из Excel')}
          <hr className="nav-sep" />
          {item('archive', <Archive size={21} />, 'Архив')}
        </div>
        <div className="sidebar-foot">
          <Database size={18} aria-hidden="true" />
          <span>{excelCount ? countText(excelCount, 'запись из Excel', 'записи из Excel', 'записей из Excel') : 'Excel ещё не импортирован'}</span>
        </div>
      </nav>
    </>
  );
}

function Shell() {
  const { data, index, loadError, reload } = useData();
  const { view, params, navigate } = useRoute();
  const isDesktop = useMedia('(min-width: 1280px)');
  const isPhone = useMedia('(max-width: 767px)');
  const [selectedId, setSelectedId] = useState(params.p || null);
  const [panelOpen, setPanelOpen] = useState(!!params.p);
  const [centerId, setCenterIdState] = useState(() => lsGet('fa_center', null));
  const [mode, setModeState] = useState(() => (params.mode === 'excel' ? 'excel' : lsGet('fa_tree_mode', 'tree')));
  const [showHyp, setShowHyp] = useState(false);
  const [scope, setScope] = useState(() => lsGet('fa_scope', 'all'));
  const [navOpen, setNavOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [peopleQuery, setPeopleQuery] = useState('');
  // Полноэкранный просмотр древа. На большом экране карточка человека при входе прячется
  // (не закрывается — несохранённые правки остаются), чтобы древо было видно целиком.
  const [treeFs, setTreeFsState] = useState(false);
  const setTreeFs = useCallback((on) => {
    setTreeFsState(on);
    if (on && window.matchMedia('(min-width: 1280px)').matches) setPanelOpen(false);
  }, []);
  useEffect(() => {
    if (view !== 'tree') setTreeFsState(false);
  }, [view]);
  // Пока древо на весь экран, то, что под ним, недоступно для клавиатуры и экранного диктора.
  // Шапка остаётся недоступной ещё немного после выхода: второе нажатие торопливого двойного
  // касания «Закрыть» не попадёт в кнопку выхода из архива на том же месте.
  const topbarTimer = useRef(null);
  useEffect(() => {
    if (!treeFs) return undefined;
    clearTimeout(topbarTimer.current);
    const els = [...document.querySelectorAll('.skip-link, .topbar, .sidebar, .view-tree > .view-header, .view-tree > .tree-toolbar')];
    els.forEach((el) => el.setAttribute('inert', ''));
    const root = document.documentElement;
    root.classList.add('tree-fs-open');
    return () => {
      root.classList.remove('tree-fs-open');
      for (const el of els) {
        if (el.classList.contains('topbar')) topbarTimer.current = setTimeout(() => el.removeAttribute('inert'), 600);
        else el.removeAttribute('inert');
      }
    };
  }, [treeFs]);

  useEffect(() => {
    if (params.p && params.p !== selectedId) {
      setSelectedId(params.p);
      setPanelOpen(true);
    }
  }, [params.p]); // eslint-disable-line react-hooks/exhaustive-deps

  // На телефоне и среднем экране карточка закрывается при переходе в другой раздел.
  const prevView = useRef(view);
  useEffect(() => {
    if (prevView.current !== view && !isDesktop) setPanelOpen(false);
    prevView.current = view;
  }, [view, isDesktop]);

  // Выбранный человек мог быть удалён или объединён.
  useEffect(() => {
    if (index && selectedId && !index.byId.has(selectedId)) {
      setSelectedId(null);
      setPanelOpen(false);
    }
    if (index && centerId && !index.byId.has(centerId)) setCenter(null);
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((v, extra = {}) => navigate(v, { ...extra, p: selectedId || undefined }), [navigate, selectedId]);
  const select = useCallback((id, { focus = false } = {}) => {
    setSelectedId(id);
    setPanelOpen(!!id);
    navigate(view, { ...params, p: id || undefined }, { replace: true });
    if (focus) setFocusTick((t) => t + 1);
  }, [navigate, view, params]);
  const setCenter = (id) => {
    setCenterIdState(id);
    lsSet('fa_center', id);
    if (id && scope === 'all') {
      setScope('family');
      lsSet('fa_scope', 'family');
    }
  };
  const setMode = (m) => {
    setModeState(m);
    lsSet('fa_tree_mode', m);
  };
  const setScopeSaved = (s) => {
    setScope(s);
    lsSet('fa_scope', s);
  };

  if (loadError && !data) {
    return (
      <div className="fullscreen-msg">
        <h1>Не удалось загрузить архив</h1>
        <p>{loadError.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => reload().catch(() => {})}><RotateCcw size={16} /> Повторить</button>
      </div>
    );
  }
  if (!data) return <div className="fullscreen-msg"><Spinner text="Загрузка архива…" /></div>;

  const pickFromSearch = (id) => {
    setSelectedId(id);
    setPanelOpen(true);
    if (view === 'tree' || view === 'people') navigate(view, { ...params, p: id }, { replace: true });
    else navigate('tree', { p: id });
    setFocusTick((t) => t + 1);
  };
  // На весь экран карточка человека открывается поверх древа и на большом экране: та же карточка
  // (без пересоздания), только стилями (.app.is-tree-fs) поставлена поверх.
  const fsOverlay = treeFs && view === 'tree';
  // Переходы из полноэкранного просмотра заменяют его запись в истории, а не добавляют новую:
  // тогда «Назад» потом ведёт туда, где человек был до древа, без «пустых» шагов.
  const go2 = (v, p) => {
    if (!fsOverlay) return navigate(v, p);
    navigate(v, p, { replace: true });
    if (v !== 'tree') window.history.replaceState(null, '', window.location.hash);
  };
  const panel = (
    <PersonPanel
      personId={panelOpen || isDesktop ? selectedId : null}
      centerId={centerId}
      closable={!isDesktop || fsOverlay}
      onClose={() => { setPanelOpen(false); if (isDesktop && !fsOverlay) select(null); }}
      onSelect={(id) => select(id, { focus: view === 'tree' })}
      onCenter={(id) => { setCenter(id); go2('tree', { p: id }); }}
      onShowTree={(id) => { setMode('tree'); go2('tree', { p: id }); setFocusTick((t) => t + 1); if (!isDesktop || fsOverlay) setPanelOpen(false); }}
      onShowExcel={(id) => { setMode('excel'); go2('tree', { p: id }); setFocusTick((t) => t + 1); if (!isDesktop || fsOverlay) setPanelOpen(false); }}
      onQuestions={(id, tab) => { go2('questions', { person: id, tab: tab || 'relations', status: 'all', p: id }); if (!isDesktop) setPanelOpen(false); }}
    />
  );
  const showOverlayPanel = !isDesktop && panelOpen && selectedId;
  // На страницах импорта и архива карточка показывается только для выбранного человека.
  const dockPanel = ['tree', 'people', 'questions'].includes(view) || (panelOpen && selectedId);

  let content;
  if (view === 'people') content = <PeopleView key={peopleQuery} initialQuery={peopleQuery} selectedId={selectedId} onSelect={(id) => select(id)} onAddPerson={() => setAdding(true)} />;
  else if (view === 'questions') content = <QuestionsView params={params} setParams={(p) => navigate('questions', p, { replace: true })} onSelect={(id) => select(id)} />;
  else if (view === 'import') content = <ImportView onDone={(v) => navigate(v)} />;
  else if (view === 'archive') content = <ArchiveView />;
  else {
    content = (
      <TreeView
        selectedId={selectedId}
        centerId={centerId}
        mode={mode}
        setMode={setMode}
        showHyp={showHyp}
        setShowHyp={setShowHyp}
        scope={scope}
        setScope={setScopeSaved}
        onSelect={(id) => select(id)}
        onCenter={setCenter}
        onQuestions={(person, tab, q) => go2('questions', { person: person || undefined, tab, q, status: q ? 'all' : undefined })}
        onImport={() => go2('import')}
        onAddPerson={() => setAdding(true)}
        focusTick={focusTick}
        fullscreen={treeFs}
        setFullscreen={setTreeFs}
        cardOpen={!!(panelOpen && selectedId)}
        onCloseCard={() => setPanelOpen(false)}
      />
    );
  }

  return (
    <div className={`app ${isPhone ? 'is-phone' : ''} ${isDesktop ? 'is-desktop' : 'is-medium'} ${fsOverlay ? 'is-tree-fs' : ''} ${fsOverlay && !(panelOpen && selectedId) ? 'fs-card-closed' : ''}`}>
      <a className="skip-link" href="#main">Перейти к содержимому</a>
      <header className="topbar">
        {isPhone && (
          <button type="button" className="icon-btn" onClick={() => setNavOpen(true)} aria-label="Открыть меню" aria-expanded={navOpen}><MenuIcon size={22} /></button>
        )}
        <div className="brand">
          <BrandMark size={isPhone ? 34 : 50} />
          <div>
            <div className="brand-title">История нашего рода</div>
            <div className="brand-sub">Семейный архив</div>
          </div>
        </div>
        <div className="topbar-right">
          <SaveStatus />
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setAdding(true)} aria-label="Добавить человека">
            <Plus size={20} /> <span className="hide-phone">Добавить человека</span>
          </button>
          {data.meta.authEnabled && (
            <button type="button" className="icon-btn" title="Выйти" aria-label="Выйти" onClick={async () => { try { await api.post('/api/auth/logout'); } finally { window.location.reload(); } }}>
              <LogOut size={20} />
            </button>
          )}
        </div>
      </header>
      <div className={`shell ${isDesktop && !dockPanel ? 'no-panel' : ''}`}>
        <Sidebar view={view} go={go} onPick={pickFromSearch} onShowAll={(q) => { setPeopleQuery(q); navigate('people'); }} open={navOpen} onClose={() => setNavOpen(false)} isPhone={isPhone} />
        <main id="main" className="main" tabIndex={-1}>{content}</main>
        {isDesktop && dockPanel && panel}
      </div>
      {showOverlayPanel && (
        <div className={isPhone ? 'sheet-layer' : `overlay-layer ${fsOverlay ? 'over-fs' : ''}`}>
          {isPhone && <div className="sheet-backdrop" onClick={() => setPanelOpen(false)} aria-hidden="true" />}
          <div className={isPhone ? 'bottom-sheet' : 'side-overlay'}>
            {isPhone && <div className="sheet-handle" aria-hidden="true" />}
            {panel}
          </div>
        </div>
      )}
      {adding && <AddPersonDialog onClose={() => setAdding(false)} onCreated={(id) => { setSelectedId(id); setPanelOpen(true); navigate(view, { ...params, p: id }, { replace: true }); setFocusTick((t) => t + 1); }} />}
      <ConfirmHost />
      <Toasts />
    </div>
  );
}

function LoginView({ onDone }) {
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { password: pwd });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <BrandMark size={112} />
        <h1>История нашего рода</h1>
        <p className="muted">Семейный архив защищён паролем.</p>
        <label className="field">
          <span className="field-label">Пароль</span>
          <input className="input" type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !pwd}>{busy ? <Loader2 size={16} className="spin" /> : <Lock size={16} />} Войти</button>
      </form>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const check = useCallback(() => {
    api.get('/api/auth/status').then(setAuth).catch((e) => setAuth({ error: e.message }));
  }, []);
  useEffect(() => {
    check();
    const on = () => setAuth((a) => ({ ...(a || {}), loggedIn: false, authEnabled: true }));
    window.addEventListener('fa:auth-required', on);
    return () => window.removeEventListener('fa:auth-required', on);
  }, [check]);
  if (!auth) return <div className="fullscreen-msg"><Spinner text="Подключение…" /></div>;
  if (auth.error) {
    return (
      <div className="fullscreen-msg">
        <h1>Нет связи с сервером</h1>
        <p>{auth.error}</p>
        <button type="button" className="btn btn-primary" onClick={() => { setAuth(null); check(); }}><RotateCcw size={16} /> Повторить</button>
      </div>
    );
  }
  if (auth.authEnabled && !auth.loggedIn) return <LoginView onDone={check} />;
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
