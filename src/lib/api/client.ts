import { REQUEST_TIMEOUT_MS, apiUrl } from "@/lib/config";
import { withLock } from "@/lib/db";
import {
  clearSession,
  getSession,
  readStoredSession,
  saveSession,
  sessionFromResponse,
  type Session,
  type TokenResponse,
} from "@/lib/auth/tokens";

/** Error devuelto por el servidor (`{code,message,field}`) o fallo de red (status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly field?: string;
  /** Cuerpo completo de la respuesta (en un 412 es el pedido actual). */
  readonly body?: unknown;

  constructor(status: number, code: string, message: string, opts: { field?: string; body?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = opts.field;
    this.body = opts.body;
  }

  /** Sin red, tiempo agotado, 5xx o 429: conviene reintentar más tarde. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  /** Por defecto true: añade `Authorization: Bearer` y refresca el token ante 401. */
  auth?: boolean;
  /** multipart (subida de imágenes) */
  form?: FormData;
  timeoutMs?: number;
  /** Respuesta binaria (CSV con BOM: `res.text()` quitaría el BOM) en vez de JSON. */
  as?: "blob";
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  let url = apiUrl(path);
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }
  return url;
}

async function parseError(res: Response): Promise<ApiError> {
  let body: any = undefined;
  try {
    body = await res.json();
  } catch {
    /* cuerpo vacío o no JSON */
  }
  const code = typeof body?.code === "string" ? body.code : res.status >= 500 ? "internal_error" : "http_error";
  const message = typeof body?.message === "string" ? body.message : `Error ${res.status}`;
  return new ApiError(res.status, code, message, { field: body?.field, body });
}

/** Una petición HTTP con timeout; convierte los fallos de red en ApiError(status 0). */
async function fetchOnce(
  method: string,
  path: string,
  opts: RequestOptions,
  token: string | null,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  try {
    return await fetch(buildUrl(path, opts.query), { method, headers, body, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new ApiError(0, "timeout", "La petición tardó demasiado");
    throw new ApiError(0, "network_error", "Sin conexión con el servidor");
  } finally {
    clearTimeout(timer);
  }
}

// ───────────── refresco de token (rotativo, de un solo vuelo) ─────────────
let refreshing: Promise<Session> | null = null;

/**
 * Pide tokens nuevos. El refreshToken rota en cada uso, así que:
 *  - solo hay un refresco a la vez (aquí y, con Web Locks, entre pestañas);
 *  - dentro del cerrojo se relee IndexedDB: si otra pestaña ya renovó, se usa lo suyo.
 * Si el servidor rechaza el refreshToken se cierra la sesión (la cola se conserva).
 * Un fallo de red NO cierra la sesión.
 */
export function refreshSession(failedAccessToken?: string): Promise<Session> {
  if (!refreshing) {
    refreshing = withLock("food-order-auth-refresh", async () => {
      const stored = await readStoredSession();
      if (!stored) throw new ApiError(401, "unauthorized", "No hay sesión iniciada");
      if (
        failedAccessToken &&
        stored.accessToken !== failedAccessToken &&
        stored.expiresAt - Date.now() > 5_000
      ) {
        return stored; // otra pestaña ya la renovó
      }
      try {
        const res = await sendJson<TokenResponse>("POST", "/v1/auth/refresh", {
          body: { refreshToken: stored.refreshToken },
          auth: false,
        });
        const next = sessionFromResponse(res, stored);
        await saveSession(next);
        return next;
      } catch (e) {
        if (e instanceof ApiError && !e.retryable) {
          await clearSession();
          throw new ApiError(401, "unauthorized", "La sesión ha caducado. Inicia sesión de nuevo.");
        }
        throw e;
      }
    }).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function sendJson<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
  const res = await fetchOnce(method, path, opts, null);
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Petición autenticada: Bearer, refresco previo si el token está a punto de caducar y reintento tras 401. */
export async function request<T = unknown>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  if (opts.auth === false) return sendJson<T>(method, path, opts);

  let session = await getSession();
  if (!session) throw new ApiError(401, "unauthorized", "No hay sesión iniciada");
  if (session.expiresAt - Date.now() < 20_000) session = await refreshSession();

  let res = await fetchOnce(method, path, opts, session.accessToken);
  if (res.status === 401) {
    session = await refreshSession(session.accessToken);
    res = await fetchOnce(method, path, opts, session.accessToken);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  if (opts.as === "blob") return (await res.blob()) as T;
  return (await res.json()) as T;
}

/** Solo para tests: olvida un refresco en curso. */
export function _resetClientState() {
  refreshing = null;
}
