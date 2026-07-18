// Shared fetch wrapper: timeout, retry with backoff+jitter on 429/5xx.
const RETRY_STATUSES = new Set([429, 500, 502, 503]);
const MAX_RETRIES = 3;
const TIMEOUT_MS = 180_000;

export class ApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.status = status;
    this.code = code || 'E_API';
    this.body = body;
  }
}

export async function apiFetch(url, options) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = 1000 * 2 ** (attempt - 1) + Math.random() * 400;
      await new Promise(r => setTimeout(r, delay));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      if (res.ok) return res;
      const body = await res.text().catch(() => '');
      if (!RETRY_STATUSES.has(res.status) || attempt === MAX_RETRIES) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(body);
          msg = j.error?.message || j.error?.status || msg;
        } catch { /* not json */ }
        throw new ApiError(msg, { status: res.status, body });
      }
      lastErr = new ApiError(`HTTP ${res.status}`, { status: res.status, body });
    } catch (e) {
      if (e instanceof ApiError && !RETRY_STATUSES.has(e.status)) throw e;
      if (e.name === 'AbortError') e.message = 'Request timed out';
      lastErr = e;
      if (attempt === MAX_RETRIES) throw lastErr;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
