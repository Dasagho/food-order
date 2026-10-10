import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Cada test arranca con almacenamiento limpio (localStorage e IndexedDB)
// y sin estado de módulo residual (cachés, conexiones abiertas).
beforeEach(() => {
  localStorage.clear();
  (globalThis as any).indexedDB = new IDBFactory();
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom no implementa estas APIs que usan Radix/recharts/calendar
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= RO;
window.HTMLElement.prototype.scrollIntoView ??= () => {};
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
