// Обращения к серверу. Все изменяющие запросы несут служебный заголовок.
export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

async function request(method, url, body, { isForm = false } = {}) {
  const headers = { 'X-Requested-With': 'family-archive' };
  let payload;
  if (body !== undefined) {
    if (isForm) payload = body;
    else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Нет связи с сервером. Проверьте, что приложение запущено, и повторите.', 0);
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    if (res.status === 401 && data?.authRequired) window.dispatchEvent(new Event('fa:auth-required'));
    throw new ApiError(data?.error || `Ошибка сервера (${res.status})`, res.status, data);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
  form: (url, formData, method = 'POST') => request(method, url, formData, { isForm: true }),
};

export const photoUrl = (photo, variant = 'thumb') => {
  if (!photo) return null;
  const file = variant === 'original' ? photo.original_file : variant === 'display' ? photo.display_file : photo.thumb_file;
  return `/media/photos/${photo.id}/${encodeURIComponent(file)}`;
};
