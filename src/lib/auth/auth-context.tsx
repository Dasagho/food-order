import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { consumeLoginRedirect, devLogin, logout as doLogout, requestPersistentStorageOnce, startMicrosoftLogin } from "./login";
import { getSession, onSessionChange, type Session, type SessionUser } from "./tokens";

export type AuthStatus = "loading" | "signedOut" | "denied" | "signedIn";

interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /** `code` de un intento de inicio de sesión fallido (se traduce en pantalla). */
  error: string | null;
  loginWithMicrosoft: () => Promise<void>;
  loginDev: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface Boot {
  status: AuthStatus;
  session: Session | null;
  error: string | null;
}

// El código `#code=` es de un solo uso: el arranque se hace una única vez aunque
// React monte el proveedor dos veces (StrictMode).
let boot: Promise<Boot> | null = null;
function bootAuth(): Promise<Boot> {
  if (!boot) {
    boot = (async (): Promise<Boot> => {
      const outcome = await consumeLoginRedirect();
      if (outcome.kind === "denied") return { status: "denied", session: null, error: "access_denied" };
      if (outcome.kind === "error") return { status: "signedOut", session: null, error: outcome.code };
      const session = outcome.kind === "signedIn" ? outcome.session : await getSession();
      return { status: session ? "signedIn" : "signedOut", session, error: null };
    })();
  }
  return boot;
}

/** Solo para tests. */
export function _resetAuthBoot() {
  boot = null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    bootAuth()
      .then((b) => {
        if (!alive) return;
        setStatus(b.status);
        setUser(b.session?.user ?? null);
        setError(b.error);
        if (b.status === "signedIn") void requestPersistentStorageOnce();
      })
      .catch((e) => {
        console.error("[auth] error al arrancar", e);
        if (alive) setStatus("signedOut");
      });
    // Cambios posteriores (login, logout, refresh rechazado en cualquier petición)
    const off = onSessionChange((s) => {
      if (!alive) return;
      setStatus(s ? "signedIn" : "signedOut");
      setUser(s?.user ?? null);
      if (s) {
        setError(null);
        void requestPersistentStorageOnce();
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const loginWithMicrosoft = useCallback(async () => {
    setError(null);
    try {
      await startMicrosoftLogin();
    } catch (e) {
      console.error("[auth] no se pudo iniciar el login", e);
      setError(e instanceof Error && e.name === "InsecureContext" ? "insecure_context" : "login_failed");
    }
  }, []);

  const loginDev = useCallback(async () => {
    setError(null);
    try {
      await devLogin();
    } catch (e) {
      console.error("[auth] dev-login falló", e);
      setError("login_failed");
    }
  }, []);

  const logout = useCallback(async () => {
    await doLogout();
  }, []);

  const value = useMemo(
    () => ({ status, user, error, loginWithMicrosoft, loginDev, logout }),
    [status, user, error, loginWithMicrosoft, loginDev, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
