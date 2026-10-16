// Холст: «Семейное древо» (подтверждённые связи) и «Исходная схема Excel».
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, MiniMap, Handle, Position, BaseEdge, EdgeLabelRenderer,
  getSmoothStepPath, getBezierPath, useReactFlow, useViewport, useStore, useStoreApi, getViewportForBounds,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { Info, Minus, Plus, Scan, LocateFixed, AlertCircle, Network, Table2, X, ChevronUp, ChevronDown, FileSpreadsheet, UserPlus, HelpCircle, Expand } from 'lucide-react';
import { useData, useUi, reportError } from '../store.jsx';
import { api } from '../api.js';
import { Avatar, Segmented, Toggle, EmptyState, Modal } from '../components/ui.jsx';
import { ConfirmHypothesisDialog, RelationEditDialog, describeHyp } from '../components/dialogs.jsx';
import { buildTree, buildExcel, hypothesisEdges, descendants, BIG, shortKin } from '../lib/graph.js';
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
      className={`pnode ${data.big ? 'pnode-big' : ''} ${selected ? 'is-selected' : ''} ${isCenter ? 'is-center' : ''} ${data.recordStatus && data.recordStatus !== 'active' ? 'is-faded' : ''}`}
      style={{ width: data.width, minHeight: data.height }}
      title={p.display_name}
    >
      <Handle type="target" position={Position.Top} id="t" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="b" isConnectable={false} />
      <Handle type="target" position={Position.Left} id="l" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="r" isConnectable={false} />
      <Avatar person={p} size={data.big ? BIG.avatar : 48} />
      <div className="pnode-body">
        <div className="pnode-name">
          <span>{line1}</span>
          {line2 && <span>{line2}</span>}
        </div>
        {!data.excel && span && <div className="pnode-meta">{span}</div>}
        {(!data.big || isCenter || kin) && (
          <div className="pnode-chips">
            {isCenter && <span className="chip chip-green">Центр</span>}
            {kin && !isCenter && <span className={`chip ${kin.unknown ? 'chip-muted' : 'chip-green'}`} title={data.big ? kin.label : undefined}>{kin.unknown ? 'Родство не установлено' : data.big ? shortKin(kin.label) : kin.label}</span>}
            {data.excel ? <span className="chip chip-muted">{data.cell}</span> : !kin && rec && !data.big && <span className="chip chip-muted">Из Excel</span>}
          </div>
        )}
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
  <div className="section-node" style={data.width ? { width: data.width } : undefined}>
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

function CanvasControls({ selectedNodeId, showHyp, mode, fullscreen, onCloseFs, onViewChange = () => {} }) {
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
        <button type="button" className="icon-btn bordered" onClick={() => { onViewChange(); rf.zoomOut({ duration: 200 }); }} aria-label="Уменьшить"><Minus size={18} /></button>
        <span className="zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-btn bordered" onClick={() => { onViewChange(); rf.zoomIn({ duration: 200 }); }} aria-label="Увеличить"><Plus size={18} /></button>
      </div>
      <div className="footer-actions">
        <button type="button" className="btn btn-outline btn-small" onClick={() => { onViewChange(true); rf.fitView(fullscreen ? { padding: FS_PADDING, maxZoom: FS_MAX_ZOOM, minZoom: FS_MIN_ZOOM, duration: 400 } : { padding: NORMAL_FIT_PADDING, duration: 400 }); }}><Scan size={15} /> Показать всё</button>
        <button type="button" className="btn btn-outline btn-small" onClick={toSelected} disabled={!selectedNodeId} aria-label="К выбранному"><LocateFixed size={15} aria-hidden="true" /> <span className="btn-label">К выбранному</span></button>
      </div>
      {/* Вторая кнопка выхода — внизу, под большим пальцем (видна на телефонах и планшетах). */}
      {fullscreen && <button type="button" className="btn btn-primary btn-small fs-exit-bottom" onClick={onCloseFs} aria-label="Закрыть полноэкранный просмотр древа"><X size={16} aria-hidden="true" /> Закрыть</button>}
    </div>
  );
}

// Мельче этого имя на экране читать трудно. На весь экран древо показывается целиком, только если
// имена при этом не мельче; иначе — крупно, начиная с выбранного человека, центра или старшего
// поколения (остальное — перетаскиванием, «Показать всё» — целиком, хоть и мелко).
const WHOLE_NAME_PX = 12;
const READABLE_NAME_PX = 14;
const FS_MAX_ZOOM = 1.6;
const FS_MIN_ZOOM = 0.03;
const FS_PADDING = 0.06;
// В обычном виде сверху отступ больше: там обозначения и кнопка «На весь экран».
const NORMAL_FIT_PADDING = { top: '60px', right: 0.12, bottom: 0.12, left: 0.12 };
const nodeSize = (n) => [n.measured?.width || n.data?.width || 260, n.measured?.height || n.data?.height || 90];

function FitOnChange({ layoutKey, normalKey, focusId, centerNodeId, topNodeId, focusTick, fullscreen, wholeZoom = 0, readableZoom = 0, nameFont = 15, onPartial = () => {}, anchorRef = null }) {
  const rf = useReactFlow();
  const store = useStoreApi();
  const paneW = useStore((s) => s.width);
  const paneH = useStore((s) => s.height);
  const first = useRef(true);
  const prevFs = useRef(fullscreen);
  // Вид до входа на весь экран: размер имён (мельче на весь экран не делаем) и положение — к нему возвращаемся после выхода.
  const entry = useRef(null);
  const restore = useRef(null);
  // Сразу после входа и выхода холст ещё меняет размер (анимация браузера) — подгонять вид снова.
  const armUntil = useRef(0);
  const lastPane = useRef({ w: 0, h: 0 });
  const partialRef = useRef(onPartial);
  partialRef.current = onPartial;
  const maxZoom = fullscreen ? FS_MAX_ZOOM : 1.1;

  const wholeView = useCallback(() => {
    const { width, height } = store.getState();
    const nodes = rf.getNodes().filter((n) => !n.hidden);
    if (!width || !height || !nodes.length) return null;
    return getViewportForBounds(rf.getNodesBounds(nodes), width, height, FS_MIN_ZOOM, FS_MAX_ZOOM, FS_PADDING);
  }, [rf, store]);

  const fit = useCallback((duration) => {
    if (!fullscreen) {
      if (restore.current) rf.setViewport(restore.current, { duration });
      else rf.fitView({ padding: NORMAL_FIT_PADDING, maxZoom, duration });
      return;
    }
    const whole = wholeView();
    if (!whole) return;
    if (whole.zoom >= wholeZoom) {
      rf.setViewport(whole, { duration });
      partialRef.current(false);
      return;
    }
    const z = Math.min(maxZoom, Math.max(readableZoom, (entry.current?.namePx || 0) / nameFont));
    const target = [focusId, centerNodeId].map((id) => id && rf.getNode(id)).find(Boolean);
    const top = topNodeId && rf.getNode(topNodeId);
    if (target) {
      // Человек — в середине экрана, но без пустого места над древом.
      const { width, height } = store.getState();
      const [w, h] = nodeSize(target);
      const topY = Math.min(...rf.getNodes().filter((n) => n.type === 'person' && !n.hidden).map((n) => n.position.y));
      const y = Math.min(height / 2 - (target.position.y + h / 2) * z, 28 - topY * z);
      rf.setViewport({ x: width / 2 - (target.position.x + w / 2) * z, y, zoom: z }, { duration });
    } else if (top) {
      // С основной ветви: её старшее поколение — вверху экрана, по центру.
      const { width } = store.getState();
      const persons = rf.getNodes().filter((n) => n.type === 'person' && !n.hidden);
      const topY = Math.min(...persons.map((n) => n.position.y));
      const cx = top.position.x + nodeSize(top)[0] / 2;
      rf.setViewport({ x: width / 2 - cx * z, y: 28 - topY * z, zoom: z }, { duration });
    } else rf.fitView({ padding: FS_PADDING, maxZoom, minZoom: FS_MIN_ZOOM, duration });
    partialRef.current(true);
  }, [rf, store, fullscreen, maxZoom, wholeZoom, readableZoom, nameFont, focusId, centerNodeId, topNodeId, wholeView]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    const toggled = prevFs.current !== fullscreen;
    if (toggled && fullscreen) {
      entry.current = { viewport: rf.getViewport(), namePx: rf.getZoom() * 15, normalKey };
      restore.current = null;
    } else if (toggled) {
      // Обычный вид не изменился — вернуть его как был; иначе показать всё.
      restore.current = entry.current?.normalKey === normalKey ? entry.current.viewport : null;
      entry.current = null;
    } else if (!fullscreen) {
      restore.current = null;
    }
    if (toggled) armUntil.current = performance.now() + 1500;
    const anchor = anchorRef?.current;
    if (anchorRef) anchorRef.current = null;
    if (fullscreen && !toggled && anchor) {
      // На весь экран после сворачивания ветви — та же карточка в том же месте экрана.
      const t = setTimeout(() => {
        const n = rf.getNode(anchor.id);
        if (!n) {
          fitRef.current(350);
          return;
        }
        const { x, y, zoom } = rf.getViewport();
        const paneShift = (store.getState().domNode?.getBoundingClientRect().top || anchor.paneTop) - anchor.paneTop;
        rf.setViewport({ x: x - (n.position.x - anchor.x) * zoom, y: y - (n.position.y - anchor.y) * zoom - paneShift, zoom }, { duration: 200 });
      }, 30);
      prevFs.current = fullscreen;
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => fitRef.current(first.current || toggled ? 0 : 350), 30);
    const t2 = toggled ? setTimeout(() => fitRef.current(200), 380) : null;
    prevFs.current = fullscreen;
    first.current = false;
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [layoutKey, fullscreen, normalKey, rf]);

  // Вход и выход из полного экрана браузера тоже меняют размер холста.
  useEffect(() => {
    const arm = () => {
      armUntil.current = performance.now() + 1500;
    };
    document.addEventListener('fullscreenchange', arm);
    document.addEventListener('webkitfullscreenchange', arm);
    return () => {
      document.removeEventListener('fullscreenchange', arm);
      document.removeEventListener('webkitfullscreenchange', arm);
    };
  }, []);

  useEffect(() => {
    const prev = lastPane.current;
    lastPane.current = { w: paneW, h: paneH };
    if (!paneW || !paneH) return undefined;
    if (performance.now() <= armUntil.current) {
      const t = setTimeout(() => fitRef.current(200), 120);
      return () => clearTimeout(t);
    }
    // Поворот телефона или другая ширина окна на весь экран: тот же масштаб и та же середина
    // (а если древо целиком теперь читаемо — целиком). Изменение только высоты (панель браузера,
    // клавиатура) вид не трогает.
    if (!fullscreen || !prev.w || Math.abs(paneW - prev.w) < 40) return undefined;
    const { x, y, zoom } = rf.getViewport();
    const cx = (prev.w / 2 - x) / zoom;
    const cy = (prev.h / 2 - y) / zoom;
    const t = setTimeout(() => {
      const whole = wholeView();
      if (whole && whole.zoom >= wholeZoom) {
        rf.setViewport(whole, { duration: 200 });
        partialRef.current(false);
      } else rf.setCenter(cx, cy, { zoom, duration: 0 });
    }, 60);
    return () => clearTimeout(t);
  }, [paneW, paneH]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusTick || !focusId) return undefined;
    const t = setTimeout(() => {
      const n = rf.getNode(focusId);
      if (!n) return;
      const [w, h] = nodeSize(n);
      rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.9), duration: 450 });
    }, 80);
    return () => clearTimeout(t);
  }, [focusTick, focusId, rf]);
  return null;
}

// ---------- Полноэкранный просмотр ----------

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

// Настоящий полный экран (компьютер, Android, iPad) запрашивается прямо в обработчике нажатия —
// иначе браузер может отказать. На iPhone его нет: древо всё равно занимает всё окно браузера.
function requestBrowserFullscreen(flag) {
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  flag.current = false;
  if (!request || fsElement()) return;
  try {
    flag.current = true;
    Promise.resolve(request.call(root, { navigationUI: 'hide' })).catch(() => {
      flag.current = false;
    });
  } catch {
    flag.current = false;
  }
}

const dialogOpen = () => !!document.querySelector('.modal-backdrop');
const typing = () => !!document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]');

// Выход — кнопкой «Закрыть», клавишей Esc, кнопкой или жестом «Назад» (у полноэкранного просмотра
// своя запись в истории браузера) и выходом из полного экрана браузера. Esc и «Назад» сначала
// закрывают то, что открыто поверх древа: окно, меню, карточку человека.
function useFullscreenMode(active, { setActive, browserFs, cardOpen, closeCard }) {
  const ref = useRef({});
  ref.current = { setActive, cardOpen, closeCard };
  // Адрес с человеком, выбранным уже на весь экран: после выхода он не должен смениться прежним.
  const hashRef = useRef('');
  useEffect(() => {
    if (active) hashRef.current = window.location.hash;
  });
  useEffect(() => {
    if (!active) return undefined;
    hashRef.current = window.location.hash;
    // Запись истории уже есть (страницу перезагрузили на весь экран) — используется она.
    const existing = window.history.state?.faTreeFs;
    const token = existing || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const mark = () => window.history.pushState({ ...(window.history.state || {}), faTreeFs: token }, '');
    const keepHash = () => {
      if (hashRef.current && window.location.hash !== hashRef.current) window.history.replaceState(window.history.state, '', hashRef.current);
    };
    if (!existing) mark();
    let pushed = true;
    let reason = 'button';
    const exit = (why) => {
      reason = why;
      ref.current.setActive(false);
    };
    const onPop = () => {
      keepHash();
      const modal = document.querySelector('.modal');
      if (modal || ref.current.cardOpen) {
        // «Назад» закрывает окно или карточку, а древо остаётся на весь экран.
        mark();
        if (modal) modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else ref.current.closeCard();
        return;
      }
      pushed = false;
      exit('back');
    };
    const onFsChange = () => {
      if (!browserFs.current || fsElement()) return;
      browserFs.current = false;
      // Браузер вышел из полного экрана (Esc, жест). Если поверх древа окно или карточка, или идёт
      // ввод — закрылся только верхний слой, древо остаётся на всё окно (кнопка «Закрыть» на месте).
      if (dialogOpen() || ref.current.cardOpen || typing()) return;
      exit('browser');
    };
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || dialogOpen() || typing() || document.querySelector('.menu-list')) return;
      e.preventDefault();
      if (ref.current.cardOpen) ref.current.closeCard();
      else exit('key');
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('keydown', onKey);
      if (browserFs.current && fsElement()) {
        const leave = document.exitFullscreen || document.webkitExitFullscreen;
        try {
          Promise.resolve(leave?.call(document)).catch(() => {});
        } catch {
          /* браузер уже вышел из полного экрана */
        }
      }
      browserFs.current = false;
      // Убрать свою запись истории (адрес — с выбранным сейчас человеком). Если открыт другой раздел,
      // запись уже не наша — её не трогаем. После выхода из полного экрана браузера — с задержкой:
      // некоторые браузеры сами делают шаг назад, и тогда второй шаг не нужен.
      if (!pushed) return;
      const pop = () => {
        if (window.history.state?.faTreeFs !== token) return;
        const h = window.location.hash;
        window.addEventListener('popstate', () => {
          if (window.location.hash !== h) window.history.replaceState(window.history.state, '', h);
        }, { once: true });
        window.history.back();
      };
      if (reason === 'browser') setTimeout(pop, 150);
      else pop();
    };
  }, [active, browserFs]);
}

// ---------- Основной компонент ----------

export function TreeView({ selectedId, centerId, mode, setMode, showHyp, setShowHyp, scope, setScope, onSelect, onCenter, onQuestions, onImport, onAddPerson, focusTick, fullscreen = false, setFullscreen = () => {}, cardOpen = false, onCloseCard = () => {} }) {
  const { data, index } = useData();
  const browserFs = useRef(false);
  useFullscreenMode(fullscreen, { setActive: setFullscreen, browserFs, cardOpen, closeCard: onCloseCard });
  // Размер экрана на момент входа — для сетки людей без связей (её форма подстраивается под экран).
  const [fsBox, setFsBox] = useState(null);
  const enterFullscreen = () => {
    requestBrowserFullscreen(browserFs);
    setFsBox({ w: window.innerWidth - 24, h: window.innerHeight - 150 });
    setFullscreen(true);
  };
  // Высота карточек считается по ширине текста — пересчитать, когда загрузится шрифт интерфейса.
  const [fontsReady, setFontsReady] = useState(() => document.fonts?.status === 'loaded');
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);
  // Фокус: при входе — на кнопку «Выйти», при выходе — обратно на «На весь экран».
  const fsEnterRef = useRef(null);
  const fsExitRef = useRef(null);
  const wasFs = useRef(false);
  // Подсказка, если на весь экран видна только часть древа (иначе имена были бы слишком мелкими).
  const [fsPartial, setFsPartial] = useState(false);
  const [fsTip, setFsTip] = useState(false);
  useEffect(() => {
    if (fullscreen) fsExitRef.current?.focus({ preventScroll: true });
    else if (wasFs.current) fsEnterRef.current?.focus({ preventScroll: true });
    wasFs.current = fullscreen;
    setFsPartial(false);
    setFsTip(fullscreen);
  }, [fullscreen]);
  useEffect(() => {
    if (!fsTip) return undefined;
    const t = setTimeout(() => setFsTip(false), 9000);
    return () => clearTimeout(t);
  }, [fsTip]);
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

  // Свернули или развернули ветвь — карточка остаётся на том же месте экрана (вид не прыгает).
  const anchorRef = useRef(null);
  const anchorAt = useCallback((id) => {
    const n = layoutRef.current.nodes?.find((x) => x.id === id);
    // Положение холста на экране тоже запоминается: над ним может появиться строка «Показать всех».
    const paneTop = document.querySelector('.canvas .react-flow')?.getBoundingClientRect().top || 0;
    anchorRef.current = n ? { id, x: n.position.x, y: n.position.y, paneTop } : null;
  }, []);
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

  // Подпись родства для расчёта высоты крупной карточки (та же, что показывается на карточке).
  const kinLabel = useCallback((pid) => {
    if (!centerId) return null;
    if (pid === centerId) return 'Центр';
    const k = kinshipLabel(centerId, pid, index);
    return k ? (k.unknown ? 'Родство не установлено' : k.label) : null;
  }, [centerId, index]);
  const layout = useMemo(() => {
    if (!data.persons.length) return { nodes: [], edges: [] };
    if (mode === 'excel') {
      if (!importDetail || importDetail.id !== currentImportId) return { nodes: [], edges: [], loading: !!currentImportId };
      return buildExcel({ data, index, importRow: importDetail, sheetName: excelSheet });
    }
    return buildTree({ data, index, scope, centerId, collapsedDown, collapsedUp, big: fullscreen, kinLabel, gridBox: fullscreen ? fsBox : null });
  }, [data, index, mode, scope, centerId, collapsedDown, collapsedUp, importDetail, currentImportId, excelSheet, fullscreen, kinLabel, fsBox, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const nodes = useMemo(() => (layout.nodes || []).map((n) => {
    const m = measured.get(n.id);
    // Размер, измеренный у карточки другого вида (обычной или крупной), не подходит — карточка измерится заново.
    const fits = !m || n.type !== 'person' || Math.abs(m.width - n.data.width) < 2;
    return {
      ...n,
      measured: fits ? m : undefined,
      ...(n.type === 'person' ? { selected: n.data.personId === selectedId, draggable: false } : {}),
    };
  }), [layout, selectedId, measured]);

  // Откуда начинать крупный просмотр, если ничего не выбрано: старшее поколение основной ветви —
  // человек верхнего ряда с наибольшим числом потомков (и середина его пары, если есть партнёр).
  const topNodeId = useMemo(() => {
    if (!fullscreen) return null;
    const persons = (layout.nodes || []).filter((n) => n.type === 'person' && !n.data.isolated);
    if (!persons.length) return null;
    const topY = Math.min(...persons.map((n) => n.position.y));
    let best = null;
    let bestCount = -1;
    for (const n of persons) {
      if (n.position.y > topY + 40) continue;
      const count = mode === 'tree' ? descendants(n.id, index).size : 0;
      if (count > bestCount) {
        best = n;
        bestCount = count;
      }
    }
    const union = (layout.edges || []).find((e) => e.type === 'partner' && e.source === best.id)?.target;
    return union || best.id;
  }, [fullscreen, layout, index, mode]);
  const kin = useMemo(() => {
    if (!centerId || mode === 'excel') return null;
    const m = new Map();
    for (const n of layout.nodes || []) if (n.type === 'person' && n.data.personId !== centerId) m.set(n.data.personId, kinshipLabel(centerId, n.data.personId, index));
    return m;
  }, [centerId, layout, index, mode]);

  const ctx = useMemo(() => ({
    index, selectedId, centerId, kin, collapsedDown, collapsedUp,
    toggleDown: (id) => { anchorAt(id); toggleDown(id); },
    toggleUp: (id) => { anchorAt(id); toggleUp(id); },
    hiddenCount: layout.hiddenCount || (() => 0),
    openHypothesis: (h) => setHypDialog(h),
    openPartnership: (p) => setPartnershipDialog(p),
  }), [index, selectedId, centerId, kin, collapsedDown, collapsedUp, toggleDown, toggleUp, anchorAt, layout]);

  const confirmedCount = data.parentChild.length + data.partnerships.length;
  const openHyps = data.hypotheses.filter((h) => h.status === 'open' || h.status === 'deferred').length;
  const normalKey = `${mode}|${scope}|${centerId}|${data.persons.length}|${confirmedCount}|${currentImportId}|${excelSheet}|${collapsedDown.size}|${collapsedUp.size}`;
  const layoutKey = `${normalKey}|${fullscreen}|${layout.loading ? 'loading' : ''}`;
  // Показать всех: снять ограничение «что показать» и развернуть свёрнутые ветви.
  const showEveryone = () => {
    setScope('all');
    setCollapsedDown(new Set());
    setCollapsedUp(new Set());
    storeSet('fa_collapsed_down', new Set());
    storeSet('fa_collapsed_up', new Set());
  };
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
  const partialTree = mode === 'tree' && personNodeCount < data.persons.length;

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
      <div className="canvas-slot">
      <div className={`canvas-card ${fullscreen ? 'is-fullscreen' : ''}`} {...(fullscreen ? { role: 'region', 'aria-label': 'Древо на весь экран' } : {})}>
        {fullscreen && (
          <div className="fs-bar">
            <div className="fs-heading">
              <strong className="fs-title">{mode === 'excel' ? 'Исходная схема Excel' : 'Семейное древо'}</strong>
              <span className="fs-sub">
                {mode === 'excel'
                  ? countText(personNodeCount, 'запись', 'записи', 'записей')
                  : partialTree ? `Показано ${personNodeCount} из ${data.persons.length}` : countText(personNodeCount, 'человек', 'человека', 'человек')}
                {center && mode === 'tree' ? ` · центр: ${center.display_name}` : ''}
              </span>
            </div>
            <div className="fs-actions">
              {mode === 'tree' && partialTree && <button type="button" className="btn btn-outline btn-small" onClick={showEveryone}>Показать всех</button>}
              {showHyp && <button type="button" className="chip chip-hyp fs-chip" onClick={() => setShowHyp(false)} aria-label="Скрыть предположения">Предположения <X size={14} aria-hidden="true" /></button>}
            </div>
            <span className="fs-hint">Закрыть можно и клавишей Esc</span>
            <button ref={fsExitRef} type="button" className="btn btn-primary fs-exit" onClick={() => setFullscreen(false)} aria-label="Закрыть полноэкранный просмотр древа">
              <X size={22} aria-hidden="true" /> Закрыть
            </button>
          </div>
        )}
        {mode === 'tree' && !confirmedCount && !fullscreen && (
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
                minZoom={fullscreen ? FS_MIN_ZOOM : 0.15}
                maxZoom={2}
                fitView
                fitViewOptions={{ padding: NORMAL_FIT_PADDING, maxZoom: 1.1 }}
                proOptions={{ hideAttribution: false }}
                attributionPosition="bottom-left"
                zoomOnDoubleClick={false}
                panOnScroll={false}
                onMoveStart={(e) => e && fsTip && setFsTip(false)}
              >
                <Background gap={22} size={1.2} color="var(--grid-dot)" />
                {personNodeCount > 12 && (
                  <MiniMap pannable zoomable position="bottom-right" ariaLabel="Миникарта" nodeColor={(n) => (n.type === 'person' ? (n.data.personId === selectedId ? '#214E42' : '#C9D6CD') : 'transparent')} nodeStrokeWidth={0} maskColor="rgba(247,245,239,0.7)" />
                )}
              </ReactFlow>
              <Legend showHyp={showHyp} mode={mode} />
              {fullscreen && fsPartial && fsTip && (
                <p className="fs-tip" role="status">Видна часть древа, чтобы имена были крупными. Двигайте древо пальцем или мышью. «Показать всё» внизу покажет его целиком, но мельче.</p>
              )}
              {!fullscreen && !layout.loading && nodes.length > 0 && (
                <button ref={fsEnterRef} type="button" className="btn btn-outline btn-small canvas-fs-btn" onClick={enterFullscreen} title="Показать древо на весь экран, крупно">
                  <Expand size={16} aria-hidden="true" /> На весь экран
                </button>
              )}
            </div>
            <FitOnChange
              layoutKey={layoutKey}
              normalKey={normalKey}
              focusId={selectedVisible ? selectedNodeId : null}
              centerNodeId={mode === 'tree' && centerId && nodes.some((n) => n.id === centerId) ? centerId : null}
              topNodeId={topNodeId}
              focusTick={focusTick}
              fullscreen={fullscreen}
              wholeZoom={WHOLE_NAME_PX / (mode === 'tree' && fullscreen ? 18 : 15)}
              readableZoom={READABLE_NAME_PX / (mode === 'tree' && fullscreen ? 18 : 15)}
              nameFont={mode === 'tree' && fullscreen ? 18 : 15}
              onPartial={setFsPartial}
              anchorRef={anchorRef}
            />
            <CanvasControls
              selectedNodeId={selectedVisible ? selectedNodeId : null}
              showHyp={showHyp}
              mode={mode}
              fullscreen={fullscreen}
              onCloseFs={() => setFullscreen(false)}
              onViewChange={(all) => {
                setFsTip(false);
                if (all) setFsPartial(false);
              }}
            />
          </TreeCtx.Provider>
        </ReactFlowProvider>
      </div>
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
