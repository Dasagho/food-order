import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { installServer, signIn } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState(null, "", "/");
});

const setHash = (h: string) => window.history.replaceState(null, "", `/${h}`);

describe("PKCE", () => {
  it("el challenge es S256 del verifier (vector de la RFC 7636)", async () => {
    const { challengeFor } = await import("@/lib/auth/login");
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("el verifier tiene entropía suficiente y es base64url", async () => {
    const { generateVerifier } = await import("@/lib/auth/login");
    const a = generateVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateVerifier()).not.toBe(a);
  });
});

describe("flujo de login con Microsoft (SPEC §4)", () => {
  it("redirige a /v1/auth/microsoft/login con redirect y challenge; el verifier va a IndexedDB", async () => {
    installServer();
    const { startMicrosoftLogin, challengeFor } = await import("@/lib/auth/login");
    const { dbGet } = await import("@/lib/db");
    let target = "";
    await startMicrosoftLogin((u) => (target = u));
    const url = new URL(target, "http://localhost");
    expect(url.pathname).toBe("/v1/auth/microsoft/login");
    expect(url.searchParams.get("redirect")).toBe(`${window.location.origin}/`);
    const row = await dbGet<{ value: { verifier: string } }>("auth", "pkce");
    expect(row).toBeDefined();
    expect(url.searchParams.get("challenge")).toBe(await challengeFor(row!.value.verifier));
    // nunca en Web Storage
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("al volver con #code= canjea el código con el verifier, guarda la sesión en IndexedDB y limpia el hash", async () => {
    const { api } = installServer();
    const { startMicrosoftLogin, consumeLoginRedirect } = await import("@/lib/auth/login");
    const tokens = await import("@/lib/auth/tokens");
    let target = "";
    await startMicrosoftLogin((u) => (target = u));
    const challenge = new URL(target, "http://localhost").searchParams.get("challenge")!;
    const code = api.issueLoginCode(challenge);

    setHash(`#code=${code}`);
    const outcome = await consumeLoginRedirect();
    expect(outcome.kind).toBe("signedIn");
    expect(window.location.hash).toBe("");
    const exchange = api.log.find((l) => l.path === "/v1/auth/exchange")!;
    expect(exchange.body.code).toBe(code);
    expect(exchange.body.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await tokens.getSession())!.user.email).toBe("dueno@ejemplo.es");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    // el verifier se consume
    const { dbGet } = await import("@/lib/db");
    expect(await dbGet("auth", "pkce")).toBeUndefined();
  });

  it("el código es de un solo uso", async () => {
    const { api } = installServer();
    const { startMicrosoftLogin, consumeLoginRedirect } = await import("@/lib/auth/login");
    let target = "";
    await startMicrosoftLogin((u) => (target = u));
    const code = api.issueLoginCode(new URL(target, "http://localhost").searchParams.get("challenge")!);
    setHash(`#code=${code}`);
    expect((await consumeLoginRedirect()).kind).toBe("signedIn");
    await startMicrosoftLogin(() => {});
    setHash(`#code=${code}`);
    expect((await consumeLoginRedirect()).kind).toBe("error");
  });

  it("#error=access_denied → acceso denegado (sin sesión)", async () => {
    installServer();
    const { consumeLoginRedirect } = await import("@/lib/auth/login");
    const tokens = await import("@/lib/auth/tokens");
    setHash("#error=access_denied");
    expect(await consumeLoginRedirect()).toEqual({ kind: "denied" });
    expect(await tokens.getSession()).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("sin verifier guardado (p. ej. otro navegador) da error y no inicia sesión", async () => {
    installServer();
    const { consumeLoginRedirect } = await import("@/lib/auth/login");
    setHash("#code=abc");
    expect((await consumeLoginRedirect()).kind).toBe("error");
  });

  it("sin hash relevante no hace nada", async () => {
    installServer();
    const { consumeLoginRedirect } = await import("@/lib/auth/login");
    setHash("#otra-cosa");
    expect(await consumeLoginRedirect()).toEqual({ kind: "none" });
    expect(window.location.hash).toBe("#otra-cosa");
  });

  it("dev-login solo funciona con VITE_DEV_LOGIN=1", async () => {
    const { api } = installServer();
    let mod = await import("@/lib/auth/login");
    await expect(mod.devLogin()).rejects.toThrow(/desactivado/);
    expect(api.log).toEqual([]);

    vi.stubEnv("VITE_DEV_LOGIN", "1");
    vi.resetModules();
    mod = await import("@/lib/auth/login");
    const session = await mod.devLogin();
    expect(session.accessToken).toMatch(/^acc-/);
    expect(api.log[0].path).toBe("/v1/auth/dev-login");
  });

  it("logout revoca el refresh token en el servidor y borra la sesión", async () => {
    const { api } = installServer();
    const s = await signIn(api);
    const { logout } = await import("@/lib/auth/login");
    const tokens = await import("@/lib/auth/tokens");
    await logout();
    expect(await tokens.getSession()).toBeNull();
    const call = api.log.find((l) => l.path === "/v1/auth/logout")!;
    expect(call.body.refreshToken).toBe(s.refreshToken);
    expect(call.headers["authorization"]).toBe(`Bearer ${s.accessToken}`); // /auth/logout exige sesión
    const again = await api.handle({ method: "POST", url: "/v1/auth/refresh", headers: {}, body: { refreshToken: s.refreshToken } });
    expect(again.status).toBe(401); // y el servidor lo revocó de verdad
  });

  it("logout no borra la cola de salida", async () => {
    const { api, ctl } = installServer();
    await signIn(api);
    ctl.down = true;
    const outbox = await import("@/lib/sync/outbox");
    await outbox.enqueueCreate({
      id: "o1",
      createdAt: new Date().toISOString(),
      paymentMethod: "efectivo",
      items: [{ productId: "1", name: "a", unitPrice: 1, quantity: 1, half: false }],
    });
    const { logout } = await import("@/lib/auth/login");
    await logout();
    expect(await outbox.listPending()).toHaveLength(1);
  });

  it("pide almacenamiento persistente UNA sola vez", async () => {
    installServer();
    const persist = vi.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, "storage", { value: { persist }, configurable: true });
    const { requestPersistentStorageOnce } = await import("@/lib/auth/login");
    await requestPersistentStorageOnce();
    await requestPersistentStorageOnce();
    vi.resetModules(); // "otro arranque": la marca está en IndexedDB
    const again = await import("@/lib/auth/login");
    await again.requestPersistentStorageOnce();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});

describe("pantallas de acceso", () => {
  async function renderGate() {
    const { AuthProvider } = await import("@/lib/auth/auth-context");
    const { AuthGate } = await import("@/features/auth/login-page");
    return render(
      <AuthProvider>
        <AuthGate>
          <p>CONTENIDO PRIVADO</p>
        </AuthGate>
      </AuthProvider>,
    );
  }

  it("sin sesión muestra 'Iniciar sesión' y no el contenido", async () => {
    installServer();
    await renderGate();
    expect(await screen.findByRole("button", { name: /Entrar con Microsoft/ })).toBeInTheDocument();
    expect(screen.queryByText("CONTENIDO PRIVADO")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /desarrollo/ })).not.toBeInTheDocument();
  });

  it("con VITE_DEV_LOGIN=1 ofrece el acceso de desarrollo y entra", async () => {
    vi.stubEnv("VITE_DEV_LOGIN", "1");
    installServer();
    await renderGate();
    await userEvent.click(await screen.findByRole("button", { name: /Entrar sin Microsoft \(desarrollo\)/ }));
    expect(await screen.findByText("CONTENIDO PRIVADO")).toBeInTheDocument();
  });

  it("con sesión guardada (también sin conexión) muestra el contenido", async () => {
    const { api, ctl } = installServer();
    await signIn(api);
    ctl.down = true;
    await renderGate();
    expect(await screen.findByText("CONTENIDO PRIVADO")).toBeInTheDocument();
  });

  it("tras #error=access_denied muestra el aviso de acceso denegado y permite volver a intentarlo", async () => {
    installServer();
    setHash("#error=access_denied");
    await renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent("Esa cuenta no tiene permiso para entrar.");
    expect(screen.queryByText("CONTENIDO PRIVADO")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Entrar con Microsoft/ })).toBeEnabled();
  });

  it("si el servidor rechaza el refresh en cualquier petición, vuelve a la pantalla de login", async () => {
    const { api } = installServer();
    await signIn(api);
    await renderGate();
    expect(await screen.findByText("CONTENIDO PRIVADO")).toBeInTheDocument();
    api.expireAccessTokens();
    api.revokeAllRefreshTokens();
    const { api: client } = await import("@/lib/api");
    await client.categories.list().catch(() => {});
    await waitFor(() => expect(screen.queryByText("CONTENIDO PRIVADO")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Entrar con Microsoft/ })).toBeInTheDocument();
  });
});

describe("garantías de código", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
    });

  it("ningún fichero de src escribe en localStorage/sessionStorage (solo se lee en la importación legacy)", () => {
    const offenders = walk("src").filter((f) => {
      const code = readFileSync(f, "utf8");
      if (/sessionStorage/.test(code)) return true;
      if (/localStorage\.(setItem|removeItem|clear)/.test(code)) return true;
      return /localStorage/.test(code) && !f.endsWith("legacy-import.ts");
    });
    expect(offenders).toEqual([]);
  });

  it("no queda rastro de PocketBase", () => {
    const pkg = readFileSync("package.json", "utf8");
    expect(pkg).not.toMatch(/pocketbase/i);
    const offenders = walk("src").filter((f) => /pocketbase/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
