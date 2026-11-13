import { ApiError, request } from "@/lib/api/client";
import { DEV_LOGIN_ENABLED, apiUrl } from "@/lib/config";
import { getMeta, setMeta } from "@/lib/db";
import {
  clearSession,
  getSession,
  saveSession,
  savePkceVerifier,
  sessionFromResponse,
  takePkceVerifier,
  type Session,
  type TokenResponse,
} from "./tokens";

// ───────────── PKCE (RFC 7636, S256) ─────────────
const b64url = (bytes: Uint8Array) => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function generateVerifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

/** URL del backend a la que se navega para iniciar sesión con Microsoft. */
export function buildLoginUrl(challenge: string, redirect: string): string {
  const qs = new URLSearchParams({ redirect, challenge });
  return `${apiUrl("/v1/auth/microsoft/login")}?${qs.toString()}`;
}

/** Guarda el verificador en IndexedDB y redirige al backend (paso 1 del flujo, SPEC §4). */
export async function startMicrosoftLogin(
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> {
  if (!globalThis.crypto?.subtle) {
    // crypto.subtle (PKCE) solo existe en https o localhost
    throw Object.assign(new Error("contexto no seguro"), { name: "InsecureContext" });
  }
  const verifier = generateVerifier();
  const challenge = await challengeFor(verifier);
  await savePkceVerifier(verifier);
  const redirect = `${window.location.origin}/`;
  navigate(buildLoginUrl(challenge, redirect));
}

export type LoginOutcome =
  | { kind: "none" }
  | { kind: "signedIn"; session: Session }
  | { kind: "denied" }
  | { kind: "error"; code: string };

/**
 * Paso 5: al volver de Microsoft el backend deja `#code=…` (o `#error=access_denied`).
 * Se limpia el hash enseguida (el código es de un solo uso) y se canjea con el verificador.
 */
export async function consumeLoginRedirect(): Promise<LoginOutcome> {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return { kind: "none" };
  const params = new URLSearchParams(hash.slice(1));
  const code = params.get("code");
  const error = params.get("error");
  if (!code && !error) return { kind: "none" };
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  if (error) {
    await takePkceVerifier();
    return error === "access_denied"
      ? { kind: "denied" }
      : { kind: "error", code: "login_failed" };
  }
  const verifier = await takePkceVerifier();
  if (!verifier) return { kind: "error", code: "state_lost" };
  try {
    const res = await request<TokenResponse>("POST", "/v1/auth/exchange", {
      body: { code, verifier },
      auth: false,
    });
    const session = sessionFromResponse(res);
    await saveSession(session);
    return { kind: "signedIn", session };
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return { kind: "denied" };
    return { kind: "error", code: e instanceof ApiError && e.isNetwork ? "network_error" : "login_failed" };
  }
}

/** Acceso de desarrollo (solo si VITE_DEV_LOGIN=1 y el backend tiene AUTH_DEV_BYPASS=1). */
export async function devLogin(): Promise<Session> {
  if (!DEV_LOGIN_ENABLED) throw new Error("El acceso de desarrollo está desactivado");
  const res = await request<TokenResponse>("POST", "/v1/auth/dev-login", { body: {}, auth: false });
  const session = sessionFromResponse(res);
  await saveSession(session);
  return session;
}

/** Cierra la sesión. Revoca el refreshToken en el servidor si hay red; la cola de salida se conserva. */
export async function logout(): Promise<void> {
  const session = await getSession();
  await clearSession();
  if (session) {
    try {
      // /auth/logout exige Bearer (SPEC §3): auth:false evita el refresco automático, no la cabecera
      await request("POST", "/v1/auth/logout", {
        body: { refreshToken: session.refreshToken },
        auth: false,
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
    } catch {
      /* sin red: el token caducará solo */
    }
  }
}

/** Pide almacenamiento persistente UNA sola vez (tras iniciar sesión). */
export async function requestPersistentStorageOnce(): Promise<void> {
  try {
    if (await getMeta("persist_requested")) return;
    await setMeta("persist_requested", true);
    await navigator.storage?.persist?.();
  } catch {
    /* no crítico */
  }
}
