// Простая навигация через hash: #/tree?p=<id>
import { useCallback, useEffect, useState } from 'react';

export const VIEWS = ['tree', 'people', 'questions', 'import', 'archive'];

function parse() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const view = VIEWS.includes(path) ? path : 'tree';
  const params = Object.fromEntries(new URLSearchParams(query));
  return { view, params };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((view, params = {}, { replace = false } = {}) => {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
    const q = new URLSearchParams(clean).toString();
    const hash = `#/${view}${q ? '?' + q : ''}`;
    if (replace) window.history.replaceState(null, '', hash);
    else window.history.pushState(null, '', hash);
    setRoute(parse());
  }, []);
  return { ...route, navigate };
}
