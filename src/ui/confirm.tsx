import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogHead } from "./dialog";
import { useI18n } from "@/i18n";

interface ConfirmOptions {
  title: string;
  text: string;
  ok: string;
  danger?: boolean;
}
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;

const Ctx = createContext<ConfirmFn | null>(null);

/** `const confirm = useConfirm(); if (await confirm({...})) …` con <dialog> nativo. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const answer = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {opts && (
        <Dialog onClose={() => answer(false)}>
          <DialogHead title={opts.title} />
          <p>{opts.text}</p>
          <div className="dlg-foot">
            <button className="btn plain" type="button" data-autofocus onClick={() => answer(false)}>
              {t("No, volver")}
            </button>
            <button className={`btn ${opts.danger ? "danger solid" : "primary"}`} type="button" onClick={() => answer(true)}>
              {opts.ok}
            </button>
          </div>
        </Dialog>
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConfirm debe usarse dentro de <ConfirmProvider>");
  return c;
}
