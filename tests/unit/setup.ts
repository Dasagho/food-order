import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Las esperas (waitFor/findBy) toleran máquinas cargadas: la cola de salida envía en segundo plano
configure({ asyncUtilTimeout: 4000 });

// Cada test arranca con almacenamiento limpio (localStorage e IndexedDB)
// y sin estado de módulo residual (cachés, conexiones abiertas).
beforeEach(() => {
  localStorage.clear();
  (globalThis as any).indexedDB = new IDBFactory();
  vi.resetModules();
  // vi.doMock persiste entre tests (resetModules no lo limpia): cada test parte sin simulacros
  for (const m of ["@/lib/order-storage", "@/lib/product-storage", "@/lib/sync/outbox"])
    vi.doUnmock(m);
  window.history.replaceState(null, "", "/");
  document.documentElement.lang = "es";
  document.documentElement.dir = "ltr";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom no implementa <dialog>.showModal()/close() (la app usa el elemento nativo)
const dlg = window.HTMLDialogElement?.prototype as any;
if (dlg) {
  dlg.showModal = function () {
    this.setAttribute("open", "");
  };
  dlg.show = dlg.showModal;
  dlg.close = function () {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

// jsdom no implementa estas APIs que usan Radix/recharts/calendar
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= RO;
window.HTMLElement.prototype.scrollIntoView ??= () => {};
window.scrollTo = (() => {}) as any;
window.matchMedia ??= ((q: string) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  onchange: null,
  dispatchEvent: () => false,
})) as any;
