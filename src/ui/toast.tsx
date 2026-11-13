import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastKind = "" | "ok" | "error";
interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}
type ToastFn = (msg: string, kind?: ToastKind) => void;

const Ctx = createContext<{ toast: ToastFn; clear: () => void } | null>(null);

/** Avisos breves en una región aria-live (no robar el foco). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const toast = useCallback<ToastFn>((msg, kind = "") => {
    const id = ++seq.current;
    setItems((l) => [...l, { id, msg, kind }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const clear = useCallback(() => setItems([]), []);
  return (
    <Ctx.Provider value={{ toast, clear }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.kind}`}>
            {i.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast debe usarse dentro de <ToastProvider>");
  return c;
}
