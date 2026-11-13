import { dbDelete, dbGet, dbPut } from "@/lib/db";

export interface SessionUser {
  email: string;
  name: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Instante (ms) en el que caduca el accessToken. */
  expiresAt: number;
  user: SessionUser;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user?: SessionUser;
}

const SESSION_KEY = "session";
const PKCE_KEY = "pkce";

let cache: Session | null | undefined; // undefined = aún no leída de IndexedDB
const listeners = new Set<(s: Session | null) => void>();

/** Lee la sesión de IndexedDB (siempre, sin caché): otra pestaña pudo rotar el token. */
export async function readStoredSession(): Promise<Session | null> {
  const row = await dbGet<{ key: string; value: Session }>("auth", SESSION_KEY);
  cache = row?.value ?? null;
  return cache;
}

export async function getSession(): Promise<Session | null> {
  if (cache === undefined) return readStoredSession();
  return cache;
}

export async function saveSession(s: Session): Promise<void> {
  await dbPut("auth", { key: SESSION_KEY, value: s });
  cache = s;
  listeners.forEach((l) => l(s));
}

export async function clearSession(): Promise<void> {
  await dbDelete("auth", SESSION_KEY);
  cache = null;
  listeners.forEach((l) => l(null));
}

export function onSessionChange(fn: (s: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sessionFromResponse(res: TokenResponse, previous?: Session | null): Session {
  return {
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
    expiresAt: Date.now() + res.expiresIn * 1000,
    user: res.user ?? previous?.user ?? { email: "", name: "" },
  };
}

// El verificador PKCE debe sobrevivir a la redirección a Microsoft: IndexedDB, nunca Web Storage.
export const savePkceVerifier = (verifier: string) =>
  dbPut("auth", { key: PKCE_KEY, value: { verifier, at: Date.now() } });
export async function takePkceVerifier(): Promise<string | null> {
  const row = await dbGet<{ value: { verifier: string } }>("auth", PKCE_KEY);
  await dbDelete("auth", PKCE_KEY);
  return row?.value.verifier ?? null;
}
