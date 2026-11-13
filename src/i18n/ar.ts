import { AR_BASE, AR_PLURALS_BASE, AR_PLURALS_SYNC, AR_SYNC } from "./ar-prototype";
import { AR_NEW, AR_PLURALS_NEW } from "./ar-new";

/** Diccionario completo español → árabe de Egipto (todo pendiente de revisión por un hablante nativo). */
export const AR = {
  strings: { ...AR_BASE, ...AR_SYNC, ...AR_NEW } as Record<string, string>,
  plurals: { ...AR_PLURALS_BASE, ...AR_PLURALS_SYNC, ...AR_PLURALS_NEW } as Record<string, string[]>,
};
