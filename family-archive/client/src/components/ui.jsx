// Базовые компоненты интерфейса.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle, CheckCircle2, Loader2, AlertCircle, MoreVertical, RotateCcw, Check } from 'lucide-react';
import { useData, useUi } from '../store.jsx';
import { photoUrl } from '../api.js';
import { initials } from '../lib/format.js';

export function Avatar({ person, size = 48, variant = 'thumb' }) {
  const { index } = useData();
  const photo = person?.primary_photo_id ? index.photosById.get(person.primary_photo_id) : null;
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (photo && !failed) {
    return <img className="avatar" style={style} src={photoUrl(photo, variant)} alt="" onError={() => setFailed(true)} draggable={false} />;
  }
  return (
    <span className="avatar avatar-initials" style={style} aria-hidden="true">
      {person ? initials(person) : '?'}
    </span>
  );
}

export function Modal({ title, onClose, children, footer, size = 'md', labelledBy }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusable = el?.querySelector('[data-autofocus], input, select, textarea, button:not(.modal-close)');
    (focusable || el)?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current?.();
      }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy || id} ref={ref} tabIndex={-1}>
        <header className="modal-head">
          <h2 id={id}>{title}</h2>
          {onClose && (
            <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Закрыть">
              <X size={20} />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmHost() {
  const { dialog } = useUi();
  const [text, setText] = useState('');
  useEffect(() => setText(''), [dialog]);
  if (!dialog) return null;
  const needText = dialog.requireText;
  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve(false)}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialog.resolve(false)}>
            {dialog.cancelText || 'Отмена'}
          </button>
          <button
            type="button"
            className={`btn ${dialog.tone === 'danger' ? 'btn-danger' : dialog.tone === 'warning' ? 'btn-warning' : 'btn-primary'}`}
            onClick={() => dialog.resolve(true)}
            disabled={needText && text.trim() !== needText}
            data-autofocus
          >
            {dialog.confirmText || 'Подтвердить'}
          </button>
        </>
      }
    >
      {dialog.message && <p className="modal-text">{dialog.message}</p>}
      {dialog.items?.length > 0 && (
        <ul className={`notice-list ${dialog.tone === 'warning' ? 'is-warning' : ''}`}>
          {dialog.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
      {dialog.body}
      {needText && (
        <label className="field">
          <span className="field-label">Для подтверждения введите «{needText}»</span>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}

export function Toasts() {
  const { toasts, setToasts } = useUi();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{t.text}</span>
          <button type="button" className="icon-btn small" aria-label="Скрыть уведомление" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function SaveStatus() {
  const { saveState } = useData();
  if (saveState.status === 'saving') {
    return (
      <span className="save-status is-saving" role="status">
        <Loader2 size={16} className="spin" /> Сохранение…
      </span>
    );
  }
  if (saveState.status === 'error') {
    return (
      <span className="save-status is-error" role="alert">
        <AlertTriangle size={16} /> <span className="save-text">Ошибка сохранения</span>
        {saveState.retry && (
          <button type="button" className="btn btn-small btn-outline-danger" onClick={saveState.retry}>
            <RotateCcw size={14} /> Повторить
          </button>
        )}
      </span>
    );
  }
  if (saveState.status === 'saved') {
    return (
      <span className="save-status is-saved" role="status">
        <Check size={16} /> Сохранено
      </span>
    );
  }
  return null;
}

export function Menu({ label = 'Ещё действия', items, icon }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const key = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
        {icon || <MoreVertical size={20} />}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.filter(Boolean).map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={`menu-item ${it.danger ? 'is-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.icon}
          <span className={`seg-full ${o.short ? 'has-short' : ''}`}>{o.label}</span>
          {o.short && <span className="seg-short">{o.short}</span>}
          {o.count != null && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id }) {
  const auto = useId();
  const tid = id || auto;
  return (
    <label className="toggle" htmlFor={tid}>
      <input id={tid} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{label}</span>
    </label>
  );
}

export function EmptyState({ icon, title, text, children }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}

export function Spinner({ text = 'Загрузка…' }) {
  return (
    <div className="spinner-block" role="status">
      <Loader2 className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}

export function Notice({ tone = 'info', title, children, icon, action }) {
  return (
    <div className={`notice notice-${tone}`}>
      {icon !== false && <span className="notice-icon">{icon || <AlertCircle size={20} />}</span>}
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div className="notice-text">{children}</div>}
        {action}
      </div>
    </div>
  );
}

// Строка «Исходная запись · Лист1!F6» и аналоги.
export function SourceBadge({ record }) {
  if (!record) return null;
  return (
    <span className="chip chip-muted" title={`Исходная запись из файла «${record.file_name}»`}>
      Из Excel · {record.cell}
    </span>
  );
}
