import { describe, it, expect, vi } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { boot } from "./helpers";
import { renderApp, waitForMenu } from "./render";

describe("idioma: español / árabe de Egipto con RTL", () => {
  it("cambiar a árabe pone lang=ar-EG y dir=rtl, traduce la interfaz y guarda la preferencia en IndexedDB (no en Web Storage)", async () => {
    await boot();
    await renderApp();
    await waitForMenu();
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("ltr");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "العربية — تغيير اللغة" }));
    expect(document.documentElement.lang).toBe("ar-EG");
    expect(document.documentElement.dir).toBe("rtl");
    const nav = screen.getByRole("navigation", { name: "الأقسام" });
    expect(within(nav).getByRole("link", { name: "الكاشير" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "المبيعات" })).toBeInTheDocument();
    // cifras árabes (٠١٢٣) por defecto y los nombres sin traducción se quedan en español
    expect(document.body).toHaveTextContent("٤٫٥٠");
    expect(screen.getByRole("heading", { name: "Paella Valenciana" })).toBeInTheDocument();
    // el botón ahora ofrece volver al español y declara su idioma
    const back = screen.getByRole("button", { name: "Español — cambiar idioma" });
    expect(back).toHaveAttribute("lang", "es");
    // aviso de revisión pendiente de un hablante nativo
    expect(screen.getByRole("note")).toBeInTheDocument();

    // persistencia: IndexedDB `meta`, nunca localStorage/sessionStorage
    const { getMeta } = await import("@/lib/db");
    await waitFor(async () => expect(await getMeta("lang")).toBe("ar"));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    await user.click(back);
    expect(document.documentElement.lang).toBe("es");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("al arrancar recupera el idioma guardado en IndexedDB", async () => {
    await boot();
    const { setMeta } = await import("@/lib/db");
    await setMeta("lang", "ar");
    await renderApp();
    await waitFor(() => expect(document.documentElement.dir).toBe("rtl"));
    expect(await screen.findByRole("link", { name: "الكاشير" })).toBeInTheDocument();
  });

  it("?lang=ar manda sobre lo guardado", async () => {
    await boot();
    window.history.replaceState(null, "", "/?lang=ar");
    await renderApp();
    await waitFor(() => expect(document.documentElement.lang).toBe("ar-EG"));
  });

  it("en árabe se traducen las pantallas (Ventas y Menú) y los errores por code", async () => {
    await boot();
    const { setLang } = await import("@/i18n");
    setLang("ar", { persist: false });
    await renderApp("/ventas");
    expect(await screen.findByRole("heading", { level: 1, name: "المبيعات" })).toBeInTheDocument();
    const { errorText } = await import("@/lib/errors");
    expect(errorText({ code: "number_taken" })).toBe("الرقم ده مستخدم في نفس اليوم.");
    expect(errorText({ code: "algo_raro" })).not.toMatch(/No se pudo/);
  });

  it("plurales árabes: 1, 2, 3-10 y 11+; español singular/plural", async () => {
    await boot();
    const { setLang, plural, num } = await import("@/i18n");
    setLang("ar", { persist: false });
    expect(plural(1, "pedido")).toBe("طلب واحد");
    expect(plural(2, "pedido")).toBe("طلبين");
    expect(plural(5, "pedido")).toBe(`${num(5)} طلبات`);
    expect(plural(11, "pedido")).toBe(`${num(11)} طلب`);
    expect(plural(103, "pedido")).toBe(`${num(103)} طلبات`);
    setLang("es", { persist: false });
    expect(plural(1, "pedido")).toBe("1 pedido");
    expect(plural(3, "pedido")).toBe("3 pedidos");
    expect(plural(1, "plato")).toBe("1 plato");
  });

  it("cifras según configuración: ٠١٢٣ por defecto y 0123 con VITE_ARABIC_DIGITS=0", async () => {
    let mod = await import("@/i18n");
    mod.setLang("ar", { persist: false });
    expect(mod.num(1234)).toMatch(/[٠-٩]/);
    expect(mod.money(4.5)).toMatch(/٤٫٥٠/);
    vi.stubEnv("VITE_ARABIC_DIGITS", "0");
    vi.resetModules();
    mod = await import("@/i18n");
    mod.setLang("ar", { persist: false });
    expect(mod.num(1234)).toMatch(/^[0-9٬,.]+$/);
    expect(mod.money(4.5)).toMatch(/4[.٫,]50/);
    vi.unstubAllEnvs();
  });
});

describe("diccionario árabe", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
    });

  it("toda cadena t(\"…\") de la interfaz tiene traducción al árabe", async () => {
    const { AR } = await import("@/i18n/ar");
    const keys = new Set<string>();
    for (const f of walk("src").filter((f) => !f.includes("i18n/ar"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${m[1]}"`));
    }
    const missing = [...keys].filter((k) => !AR.strings[k]);
    expect(missing).toEqual([]);
  });

  it("toda cadena árabe AÑADIDA en la versión React lleva «REVISAR (hablante nativo)»", () => {
    const lines = readFileSync("src/i18n/ar-new.ts", "utf8")
      .split("\n")
      .filter((l) => /^\s+"[^"]+":\s*"/.test(l) || /^\s+\w+:\s*\[/.test(l));
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.filter((l) => !l.includes("// REVISAR (hablante nativo)"))).toEqual([]);
  });

  it("no se copia la clave `od_lang` del prototipo ni se usa Web Storage para el idioma", () => {
    const offenders = walk("src").filter((f) => /od_lang/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
