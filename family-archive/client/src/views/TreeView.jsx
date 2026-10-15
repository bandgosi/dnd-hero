// Холст: «Семейное древо» (подтверждённые связи) и «Исходная схема Excel».
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, MiniMap, Handle, Position, BaseEdge, EdgeLabelRenderer,
  getSmoothStepPath, getBezierPath, useReactFlow, useViewport,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Info, Minus, Plus, Maximize2, LocateFixed, AlertCircle, Network, Table2, X, ChevronUp, ChevronDown, FileSpreadsheet, UserPlus, HelpCircle } from 'lucide-react';
import { useData, useUi, reportError } from '../store.jsx';
import { api } from '../api.js';
import { Avatar, Segmented, Toggle, EmptyState, Modal } from '../components/ui.jsx';
import { ConfirmHypothesisDialog, RelationEditDialog, describeHyp } from '../components/dialogs.jsx';
import { buildTree, buildExcel, hypothesisEdges } from '../lib/graph.js';
import { kinshipLabel } from '../lib/kinship.js';
import { splitName, lifeSpan, countText, PARENT_KIND_LABELS, PARTNER_KIND_LABELS, PARTNER_STATUS_LABELS, HYP_STATUS_LABELS } from '../lib/format.js';

const TreeCtx = createContext(null);

function loadSet(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
  } catch {
    return new Set();
  }
}
function storeSet(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* хранилище браузера недоступно — не страшно */
  }
}

// ---------- Узлы ----------

const PersonNode = memo(({ data }) => {
  const ctx = useContext(TreeCtx);
  const p = ctx.index.byId.get(data.personId);
  if (!p) return null;
  const selected = ctx.selectedId === p.id;
  const isCenter = ctx.centerId === p.id;
  const [line1, line2] = splitName(p);
  const span = lifeSpan(p);
  const rec = ctx.index.recordsByPerson.get(p.id)?.find((r) => r.status === 'active');
  const kin = ctx.kin?.get(p.id);
  const hasChildren = !data.excel && (ctx.index.childrenOf.get(p.id) || []).length > 0;
  const hasParents = !data.excel && (ctx.index.parentsOf.get(p.id) || []).length > 0;
  const downCollapsed = ctx.collapsedDown.has(p.id);
  const upCollapsed = ctx.collapsedUp.has(p.id);
  return (
    <div
      className={`pnode ${selected ? 'is-selected' : ''} ${isCenter ? 'is-center' : ''} ${data.recordStatus && data.recordStatus !== 'active' ? 'is-faded' : ''}`}
      style={{ width: data.width, minHeight: data.height }}
      title={p.display_name}
    >
      <Handle type="target" position={Position.Top} id="t" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={false} />
      <Handle type="target" position={Position.Left} id="l" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="r" isConnectable={false} />
      <Avatar person={p} size={48} />
      <div className="pnode-body">
        <div className="pnode-name">
          <span>{line1}</span>
          {line2 && <span>{line2}</span>}
        </div>
        {!data.excel && span && <div className="pnode-meta">{span}</div>}
        <div className="pnode-chips">
          {isCenter && <span className="chip chip-green">Центр</span>}
          {kin && !isCenter && <span className={`chip ${kin.unknown ? 'chip-muted' : 'chip-green'}`}>{kin.unknown ? 'Родство не установлено' : kin.label}</span>}
          {data.excel ? <span className="chip chip-muted">{data.cell}</span> : !kin && rec && <span className="chip chip-muted">Из Excel</span>}
        </div>
      </div>
      {hasParents && (
        <button type="button" className={`pnode-toggle up nodrag ${upCollapsed ? 'is-collapsed' : ''}`} onClick={(e) => { e.stopPropagation(); ctx.toggleUp(p.id); }} aria-label={upCollapsed ? 'Показать предков' : 'Свернуть предков'} title={upCollapsed ? 'Показать предков' : 'Свернуть предков'}>
          {upCollapsed ? <span>+{ctx.hiddenCount(p.id, 'up')}</span> : <ChevronUp size={14} />}
        </button>
      )}
      {hasChildren && (
        <button type="button" className={`pnode-toggle down nodrag ${downCollapsed ? 'is-collapsed' : ''}`} onClick={(e) => { e.stopPropagation(); ctx.toggleDown(p.id); }} aria-label={downCollapsed ? 'Показать потомков' : 'Свернуть потомков'} title={downCollapsed ? 'Показать потомков' : 'Свернуть потомков'}>
          {downCollapsed ? <span>+{ctx.hiddenCount(p.id, 'down')}</span> : <ChevronDown size={14} />}
        </button>
      )}
    </div>
  );
});

const UnionNode = memo(({ data }) => {
  const ctx = useContext(TreeCtx);
  if (data.kind === 'coparents') {
    return (
      <div className="union union-co" title="Общие дети; партнёрство не указано">
        <Handle type="target" position={Position.Top} id="t" isConnectable={false} />
        <Handle type="source" position={Position.Bottom} id="b" isConnectable={false} />
      </div>
    );
  }
  const p = data.partnership;
  const label = `Партнёрство: ${PARTNER_KIND_LABELS[p.kind]}, ${PARTNER_STATUS_LABELS[p.status].toLowerCase()}`;
  return (
    <button type="button" className="union union-partner nodrag" title={label} aria-label={`${label}. Открыть`} onClick={(e) => { e.stopPropagation(); ctx.openPartnership(p); }}>
      <Handle type="target" position={Position.Top} id="t" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={false} />
      <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true">
        <circle cx="5.5" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="10.5" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </button>
  );
});

const SectionNode = memo(({ data }) => (
  <div className="section-node">
    <strong>Пока без подтверждённых связей · {data.count}</strong>
    <span>{data.hasTree ? 'Эти люди появятся в древе, когда вы подтвердите их связи.' : 'Люди показаны отдельно, без домысленного древа. Связи подтверждаются в разделе «Уточнить связи».'}</span>
  </div>
));

const GridHeadNode = memo(({ data }) => (
  <div className={`grid-head ${data.muted ? 'is-muted' : ''}`} style={{ width: data.width, height: data.height }}>{data.label}</div>
));

const CellBoxNode = memo(({ data }) => {
  const b = data.border || {};
  const line = '1.5px solid var(--sheet-line)';
  return (
    <div
      className={`cellbox ${data.empty ? 'is-empty' : ''}`}
      style={{ width: data.width, height: data.height, borderTop: b.top ? line : 'none', borderRight: b.right ? line : 'none', borderBottom: b.bottom ? line : 'none', borderLeft: b.left ? line : 'none' }}
      title={data.empty ? `${data.ref}: пустая ячейка с границей` : data.ref}
    />
  );
});

const nodeTypes = { person: PersonNode, union: UnionNode, section: SectionNode, gridhead: GridHeadNode, cellbox: CellBoxNode };

// ---------- Линии ----------

function PartnerEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: 'var(--green)', strokeWidth: 5 }} />
      <path d={path} fill="none" style={{ stroke: 'var(--surface)', strokeWidth: 1.6 }} />
    </>
  );
}

function ParentEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  const kinds = (data?.rels || []).map((r) => r.kind).filter((k) => k && k !== 'biological' && k !== 'unknown');
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: 'var(--line-strong)', strokeWidth: 1.8 }} />
      {kinds.length > 0 && (
        <EdgeLabelRenderer>
          <div className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly + 10}px)` }}>{PARENT_KIND_LABELS[kinds[0]]}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function CoparentEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 10 });
  return <BaseEdge id={id} path={path} style={{ stroke: 'var(--line-strong)', strokeWidth: 1.6 }} />;
}

function HypothesisEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }) {
  const ctx = useContext(TreeCtx);
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 });
  const h = data.hypothesis;
  const d = describeHyp(h, ctx.index);
  const hl = data.highlight;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: 'var(--hyp)', strokeWidth: hl ? 2.4 : 1.6, strokeDasharray: '6 5', opacity: ctx.selectedId && !hl ? 0.45 : 1 }} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`hyp-marker nodrag nopan ${hl ? 'is-wide' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, opacity: ctx.selectedId && !hl ? 0.6 : 1 }}
          onClick={(e) => { e.stopPropagation(); ctx.openHypothesis(h); }}
          aria-label={`Предположение: ${d.text}`}
          title={`Предположение: ${d.text}`}
        >
          <span className="hyp-q">?</span>
          <span className={`hyp-word ${data.showWord ? '' : 'on-hover'}`}>Предположение</span>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { partner: PartnerEdge, parent: ParentEdge, coparent: CoparentEdge, hypothesis: HypothesisEdge };

// ---------- Окно предположения ----------

function HypothesisDialog({ hypothesis, onClose, onOpenQuestion }) {
  const { index, save } = useData();
  const ui = useUi();
  const [confirming, setConfirming] = useState(false);
  if (confirming) return <ConfirmHypothesisDialog hypothesis={hypothesis} onClose={onClose} />;
  const d = describeHyp(hypothesis, index);
  const reject = async () => {
    try {
      await save(() => api.post(`/api/hypotheses/${hypothesis.id}/reject`, {}), { success: 'Предположение отклонено' });
      onClose();
    } catch (e) {
      reportError(ui, e);
    }
  };
  return (
    <Modal
      title="Предположение"
      onClose={onClose}
      size="sm"
      footer={
        <>
          {hypothesis.question_id && <button type="button" className="btn btn-ghost mr-auto" onClick={() => onOpenQuestion(hypothesis.question_id)}>Открыть вопрос</button>}
          <button type="button" className="btn btn-outline" onClick={reject}>Отклонить</button>
          <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)}>{hypothesis.type === 'same_person' ? 'Объединить…' : 'Подтвердить…'}</button>
        </>
      }
    >
      <p className="modal-lead">{d.text}</p>
      <p className="muted small">Статус: {HYP_STATUS_LABELS[hypothesis.status]}. Предположение не участвует в древе и в вычислении родства.</p>
      <h4 className="subhead">Основание</h4>
      <ul className="basis-list">{hypothesis.basis.map((b, i) => <li key={i}>{b.text}</li>)}</ul>
    </Modal>
  );
}

// ---------- Нижняя панель управления ----------

function CanvasControls({ selectedNodeId, showHyp, mode }) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const toSelected = () => {
    const n = selectedNodeId && rf.getNode(selectedNodeId);
    if (!n) return;
    const w = n.measured?.width || n.data.width || 260;
    const h = n.measured?.height || n.data.height || 90;
    rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(zoom, 1), duration: 400 });
  };
  return (
    <div className="canvas-footer">
      <p className="canvas-note">
        <Info size={16} aria-hidden="true" />
        {mode === 'excel'
          ? 'Расположение как в файле Excel. Соседство и рамки не означают родства.'
          : showHyp ? 'Показаны предположения, а не установленные связи.' : 'Показаны только подтверждённые связи.'}
      </p>
      <div className="zoom-group" role="group" aria-label="Масштаб">
        <button type="button" className="icon-btn bordered" onClick={() => rf.zoomOut({ duration: 200 })} aria-label="Уменьшить"><Minus size={18} /></button>
        <span className="zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-btn bordered" onClick={() => rf.zoomIn({ duration: 200 })} aria-label="Увеличить"><Plus size={18} /></button>
      </div>
      <div className="footer-actions">
        <button type="button" className="btn btn-outline btn-small" onClick={() => rf.fitView({ padding: 0.12, duration: 400 })}><Maximize2 size={15} /> Показать всё</button>
        <button type="button" className="btn btn-outline btn-small" onClick={toSelected} disabled={!selectedNodeId}><LocateFixed size={15} /> К выбранному</button>
      </div>
    </div>
  );
}

function FitOnChange({ layoutKey, focusId, focusTick }) {
  const rf = useReactFlow();
  const first = useRef(true);
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.12, duration: first.current ? 0 : 350, maxZoom: 1.1 }), 30);
    first.current = false;
    return () => clearTimeout(t);
  }, [layoutKey, rf]);
  useEffect(() => {
    if (!focusTick || !focusId) return undefined;
    const t = setTimeout(() => {
      const n = rf.getNode(focusId);
      if (!n) return;
      const w = n.measured?.width || n.data.width || 260;
      const h = n.measured?.height || n.data.height || 90;
      rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 450 });
    }, 80);
    return () => clearTimeout(t);
  }, [focusTick, focusId, rf]);
  return null;
}

// ---------- Основной компонент ----------

export function TreeView({ selectedId, centerId, mode, setMode, showHyp, setShowHyp, scope, setScope, onSelect, onCenter, onQuestions, onImport, onAddPerson, focusTick }) {
  const { data, index } = useData();
  const [collapsedDown, setCollapsedDown] = useState(() => loadSet('fa_collapsed_down'));
  const [collapsedUp, setCollapsedUp] = useState(() => loadSet('fa_collapsed_up'));
  const [hypDialog, setHypDialog] = useState(null);
  const [partnershipDialog, setPartnershipDialog] = useState(null);
  const [excelImportId, setExcelImportId] = useState(null);
  const [excelSheet, setExcelSheet] = useState(null);
  const [importDetail, setImportDetail] = useState(null);

  const completedImports = data.imports.filter((i) => i.status === 'completed');
  const currentImportId = excelImportId && completedImports.some((i) => i.id === excelImportId) ? excelImportId : completedImports[0]?.id;
  useEffect(() => {
    if (mode !== 'excel' || !currentImportId) return undefined;
    if (importDetail?.id === currentImportId) return undefined;
    let cancelled = false;
    api.get(`/api/imports/${currentImportId}`).then((r) => !cancelled && setImportDetail(r)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode, currentImportId, importDetail]);

  const toggleDown = useCallback((id) => setCollapsedDown((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    storeSet('fa_collapsed_down', n);
    return n;
  }), []);
  const toggleUp = useCallback((id) => setCollapsedUp((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    storeSet('fa_collapsed_up', n);
    return n;
  }), []);

  const layout = useMemo(() => {
    if (!data.persons.length) return { nodes: [], edges: [] };
    if (mode === 'excel') {
      if (!importDetail || importDetail.id !== currentImportId) return { nodes: [], edges: [], loading: !!currentImportId };
      return buildExcel({ data, index, importRow: importDetail, sheetName: excelSheet });
    }
    return buildTree({ data, index, scope, centerId, collapsedDown, collapsedUp });
  }, [data, index, mode, scope, centerId, collapsedDown, collapsedUp, importDetail, currentImportId, excelSheet]);

  const nodeIdFor = useCallback((pid) => (mode === 'excel' ? layout.personNode?.get(pid) || pid : pid), [mode, layout]);
  const edges = useMemo(() => {
    const base = layout.edges || [];
    if (!showHyp) return base;
    return [...base, ...hypothesisEdges(data.hypotheses, layout.nodes, { selectedId, nodeIdFor })];
  }, [layout, showHyp, data.hypotheses, selectedId, nodeIdFor]);

  // Размеры узлов, измеренные холстом, нужны миникарте и «Показать всё».
  const [measured, setMeasured] = useState(() => new Map());
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const onNodesChange = useCallback((changes) => {
    // Выбор с клавиатуры (Enter на карточке) открывает карточку человека.
    for (const c of changes) {
      if (c.type === 'select' && c.selected) {
        const n = layoutRef.current.nodes?.find((x) => x.id === c.id);
        if (n?.type === 'person') onSelect(n.data.personId);
      }
    }
    if (!changes.some((c) => c.type === 'dimensions' && c.dimensions)) return;
    setMeasured((prev) => {
      const m = new Map(prev);
      for (const c of changes) if (c.type === 'dimensions' && c.dimensions) m.set(c.id, c.dimensions);
      return m;
    });
  }, [onSelect]);
  const nodes = useMemo(() => (layout.nodes || []).map((n) => ({
    ...n,
    measured: measured.get(n.id),
    ...(n.type === 'person' ? { selected: n.data.personId === selectedId, draggable: false } : {}),
  })), [layout, selectedId, measured]);

  const kin = useMemo(() => {
    if (!centerId || mode === 'excel') return null;
    const m = new Map();
    for (const n of layout.nodes || []) if (n.type === 'person' && n.data.personId !== centerId) m.set(n.data.personId, kinshipLabel(centerId, n.data.personId, index));
    return m;
  }, [centerId, layout, index, mode]);

  const ctx = useMemo(() => ({
    index, selectedId, centerId, kin, collapsedDown, collapsedUp, toggleDown, toggleUp,
    hiddenCount: layout.hiddenCount || (() => 0),
    openHypothesis: (h) => setHypDialog(h),
    openPartnership: (p) => setPartnershipDialog(p),
  }), [index, selectedId, centerId, kin, collapsedDown, collapsedUp, toggleDown, toggleUp, layout]);

  const confirmedCount = data.parentChild.length + data.partnerships.length;
  const openHyps = data.hypotheses.filter((h) => h.status === 'open' || h.status === 'deferred').length;
  const layoutKey = `${mode}|${scope}|${centerId}|${data.persons.length}|${confirmedCount}|${currentImportId}|${excelSheet}|${collapsedDown.size}|${collapsedUp.size}`;
  const center = centerId ? index.byId.get(centerId) : null;

  if (!data.persons.length) {
    return (
      <section className="view view-tree">
        <ViewHeader title="Семейное древо" subtitle="Архив пока пуст" />
        <div className="canvas-card canvas-empty">
          <EmptyState icon={<Network size={30} />} title="Начните с исходного файла или первого человека" text="Импортируйте набросок семьи из Excel — все записи попадут в архив без домысленных связей. Или добавьте человека вручную.">
            <button type="button" className="btn btn-primary" onClick={onImport}><FileSpreadsheet size={17} /> Импорт из Excel</button>
            <button type="button" className="btn btn-outline" onClick={onAddPerson}><UserPlus size={17} /> Добавить человека</button>
          </EmptyState>
        </div>
      </section>
    );
  }

  const selectedNodeId = selectedId ? (mode === 'excel' ? layout.personNode?.get(selectedId) : selectedId) : null;
  const selectedVisible = selectedNodeId && nodes.some((n) => n.id === selectedNodeId);
  const personNodeCount = nodes.filter((n) => n.type === 'person').length;

  return (
    <section className="view view-tree">
      <ViewHeader
        title={mode === 'excel' ? 'Исходная схема Excel' : 'Семейное древо'}
        subtitle={mode === 'excel' ? 'Относительное расположение записей в файле' : showHyp ? 'Предположения требуют подтверждения' : confirmedCount ? 'Подтверждённые связи' : 'Связи ещё не подтверждены'}
        badge={openHyps > 0 && (
          <button type="button" className="status-pill is-warning" onClick={() => onQuestions()}>
            <AlertCircle size={18} /> {confirmedCount ? `Предположений не решено: ${openHyps}` : 'Связи не подтверждены'}
          </button>
        )}
      />
      <div className="tree-toolbar">
        <Segmented
          label="Представление"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'tree', label: 'Семейное древо', short: 'Древо', icon: <Network size={16} /> },
            { value: 'excel', label: 'Исходная схема Excel', short: 'Схема Excel', icon: <Table2 size={16} /> },
          ]}
        />
        <Toggle checked={showHyp} onChange={setShowHyp} label="Показать предположения" />
        {mode === 'tree' && center && (
          <div className="center-controls">
            <span className="chip chip-green chip-lg">Центр: {center.display_name}
              <button type="button" className="chip-x" onClick={() => onCenter(null)} aria-label="Сбросить центр"><X size={14} /></button>
            </span>
            <label className="visually-hidden" htmlFor="scope-select">Что показать</label>
            <select id="scope-select" className="input input-small" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">Все люди</option>
              <option value="family">Вся связанная семья</option>
              <option value="close">Ближайшие родственники</option>
              <option value="ancestors">Предки</option>
              <option value="descendants">Потомки</option>
            </select>
          </div>
        )}
        {mode === 'excel' && completedImports.length > 1 && (
          <select className="input input-small" value={currentImportId} onChange={(e) => { setExcelImportId(e.target.value); setExcelSheet(null); }} aria-label="Файл импорта">
            {completedImports.map((i) => <option key={i.id} value={i.id}>{i.file_name} · {new Date(i.created_at).toLocaleDateString('ru-RU')}</option>)}
          </select>
        )}
        {mode === 'excel' && layout.sheets?.length > 1 && (
          <select className="input input-small" value={layout.sheet} onChange={(e) => setExcelSheet(e.target.value)} aria-label="Лист">
            {layout.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      <div className="canvas-card">
        {mode === 'tree' && !confirmedCount && (
          <div className="canvas-banner" role="note">
            <HelpCircle size={20} aria-hidden="true" />
            <div>
              <strong>Подтверждённых связей пока нет.</strong>
              <span> Все {countText(data.persons.length, 'запись доступна', 'записи доступны', 'записей доступны')} ниже. Древо появится, когда вы подтвердите связи.</span>
            </div>
            <div className="banner-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => onQuestions()}>Уточнить связи</button>
              <button type="button" className="btn btn-small btn-outline" onClick={() => setMode('excel')}>Исходная схема</button>
            </div>
          </div>
        )}
        <ReactFlowProvider>
          <TreeCtx.Provider value={ctx}>
            <div className="canvas" aria-label={mode === 'excel' ? 'Исходная схема Excel' : 'Семейное древо'}>
              {mode === 'excel' && !currentImportId && (
                <div className="canvas-center">
                  <EmptyState icon={<Table2 size={28} />} title="Нет импортированных файлов" text="Исходная схема появится после импорта Excel.">
                    <button type="button" className="btn btn-primary" onClick={onImport}>Импорт из Excel</button>
                  </EmptyState>
                </div>
              )}
              {layout.loading && <div className="canvas-center"><span className="muted">Загрузка схемы…</span></div>}
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={(_, n) => n.type === 'person' && onSelect(n.data.personId)}
                onNodesChange={onNodesChange}
                onPaneClick={() => {}}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesFocusable={false}
                minZoom={0.15}
                maxZoom={2}
                fitView
                fitViewOptions={{ padding: 0.12, maxZoom: 1.1 }}
                proOptions={{ hideAttribution: false }}
                attributionPosition="bottom-left"
                zoomOnDoubleClick={false}
                panOnScroll={false}
              >
                <Background gap={22} size={1.2} color="var(--grid-dot)" />
                {personNodeCount > 12 && (
                  <MiniMap pannable zoomable position="bottom-right" ariaLabel="Миникарта" nodeColor={(n) => (n.type === 'person' ? (n.data.personId === selectedId ? '#214E42' : '#C9D6CD') : 'transparent')} nodeStrokeWidth={0} maskColor="rgba(247,245,239,0.7)" />
                )}
              </ReactFlow>
              <Legend showHyp={showHyp} mode={mode} />
            </div>
            <FitOnChange layoutKey={layoutKey} focusId={selectedNodeId} focusTick={focusTick} />
            <CanvasControls selectedNodeId={selectedVisible ? selectedNodeId : null} showHyp={showHyp} mode={mode} />
          </TreeCtx.Provider>
        </ReactFlowProvider>
      </div>
      {hypDialog && <HypothesisDialog hypothesis={data.hypotheses.find((h) => h.id === hypDialog.id) || hypDialog} onClose={() => setHypDialog(null)} onOpenQuestion={(qid) => { setHypDialog(null); onQuestions(null, 'relations', qid); }} />}
      {partnershipDialog && <RelationEditDialog relation={data.partnerships.find((p) => p.id === partnershipDialog.id) || partnershipDialog} type="partnership" onClose={() => setPartnershipDialog(null)} />}
    </section>
  );
}

function Legend({ showHyp, mode }) {
  return (
    <div className="legend" aria-label="Обозначения">
      {mode === 'tree' && (
        <>
          <span className="legend-item"><svg width="28" height="10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" stroke="var(--line-strong)" strokeWidth="2" /></svg> Родитель — ребёнок</span>
          <span className="legend-item"><svg width="28" height="10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" stroke="var(--green)" strokeWidth="5" /><line x1="0" y1="5" x2="28" y2="5" stroke="var(--surface)" strokeWidth="1.6" /></svg> Партнёрство</span>
        </>
      )}
      {showHyp && <span className="legend-item"><svg width="28" height="10" aria-hidden="true"><line x1="0" y1="5" x2="28" y2="5" stroke="var(--hyp)" strokeWidth="2" strokeDasharray="5 4" /></svg> <span className="legend-q">?</span> Предположение</span>}
      {mode === 'excel' && <span className="legend-item"><span className="legend-box" aria-hidden="true" /> Граница ячейки в Excel</span>}
    </div>
  );
}

export function ViewHeader({ title, subtitle, badge, actions }) {
  return (
    <header className="view-header">
      <div>
        <h1 className="view-title">{title}</h1>
        {subtitle && <p className="view-subtitle">{subtitle}</p>}
      </div>
      <div className="view-header-actions">
        {badge}
        {actions}
      </div>
    </header>
  );
}
