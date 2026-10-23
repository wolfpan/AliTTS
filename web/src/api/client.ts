// REST + POST-SSE 客户端封装
export class ApiError extends Error {
  code: string;
  requestId?: string;
  constructor(code: string, message: string, requestId?: string) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}

// ---- 访问令牌（服务端开启后所有 /api 需携带）----
const TOKEN_STORAGE_KEY = 'alitts_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}
export function setToken(t: string): void {
  if (t) localStorage.setItem(TOKEN_STORAGE_KEY, t);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}
function tokenHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { 'X-AliTTS-Token': t } : {};
}

// 音频文件直链（<audio src>/下载用）：令牌经 ?token= 查询参数传递
export function audioUrl(file: string): string {
  const t = getToken();
  return `/api/audio/${encodeURIComponent(file)}${t ? `?token=${encodeURIComponent(t)}` : ''}`;
}

// 令牌缺失/错误时通知 App 弹窗索取（401 事件去抖：正在弹窗时不重复触发）
let tokenPrompting = false;
function notifyTokenRequired() {
  if (tokenPrompting) return;
  tokenPrompting = true;
  window.dispatchEvent(new CustomEvent('alitts:token-required'));
  setTimeout(() => { tokenPrompting = false; }, 4000);
}

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: tokenHeaders() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) notifyTokenRequired();
    throw new ApiError(j?.error?.code || 'HTTP_' + r.status, j?.error?.message || r.statusText);
  }
  return j as T;
}

export async function apiSend<T>(path: string, method: 'PUT' | 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...tokenHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) notifyTokenRequired();
    throw new ApiError(j?.error?.code || 'HTTP_' + r.status, j?.error?.message || r.statusText);
  }
  return j as T;
}

export interface TtsMetaEvent { type: 'meta'; model: string; voice: string; format: string; sampleRate: number | null; chunks: number; chars: number; streamable?: boolean }
export interface TtsAudioEvent { type: 'audio'; data: string }
export interface TtsProgressEvent { type: 'progress'; chunk: number; total: number }
export interface TtsWordsEvent { type: 'words'; chunk: number; index: number; words: Array<{ text: string; begin_time?: number; end_time?: number }> }
export interface TtsDoneEvent { type: 'done'; historyId: string; fileId: string; url: string; mime: string; bytes: number; elapsedMs: number; requestId: string }
export interface TtsErrorEvent { type: 'error'; code: string; message: string; requestId: string }
export interface TtsAbortedEvent { type: 'aborted' }
export type TtsEvent = TtsMetaEvent | TtsAudioEvent | TtsProgressEvent | TtsWordsEvent | TtsDoneEvent | TtsErrorEvent | TtsAbortedEvent;

export interface TtsRequestBody {
  model: string;
  voice: string;
  text: string;
  templateId?: string;
  params?: Record<string, unknown>;
}

/**
 * 发起合成并以回调形式消费 SSE 事件流。
 * 返回直到 done/error/aborted 才 resolve 的 Promise（error 时 reject ApiError）。
 */
export async function runTts(
  body: TtsRequestBody,
  handlers: {
    onEvent: (e: TtsEvent) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tokenHeaders() },
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) notifyTokenRequired();
    throw new ApiError(j?.error?.code || 'HTTP_' + res.status, j?.error?.message || '请求失败');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        for (const line of block.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          let evt: TtsEvent;
          try {
            evt = JSON.parse(trimmed.slice(5).trim());
          } catch {
            continue;
          }
          handlers.onEvent(evt);
          if (evt.type === 'error') {
            throw new ApiError(evt.code, evt.message, evt.requestId);
          }
          if (evt.type === 'done' || evt.type === 'aborted') {
            return;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
