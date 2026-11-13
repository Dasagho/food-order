import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  /** Se llama al pulsar Esc o fuera del cuadro; el padre decide si lo cierra (desmonta). */
  onClose: () => void;
  /** id del título (aria-labelledby). */
  labelledBy?: string;
  children: ReactNode;
}

/**
 * Diálogo modal con el elemento nativo <dialog> + showModal(): foco atrapado, Esc, fondo inerte.
 * Se monta solo cuando está abierto. Al mostrarse, el foco va al elemento con `data-autofocus` (o al
 * primer campo/botón); al cerrarse, vuelve al control que lo abrió.
 */
export function Dialog({ onClose, labelledBy = "dlg-title", children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dlg.open) dlg.showModal();
    const first = dlg.querySelector<HTMLElement>(
      "[data-autofocus], input:not([type=file]):not([disabled]), select:not([disabled]), button:not([disabled])",
    );
    first?.focus();

    const onCancel = (e: Event) => {
      e.preventDefault(); // el padre decide (p. ej. no se cierra mientras se guarda)
      closeRef.current();
    };
    const onClick = (e: MouseEvent) => {
      if (e.target === dlg) closeRef.current();
    };
    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("click", onClick);
    return () => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("click", onClick);
      if (dlg.open) dlg.close();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  return (
    <dialog ref={ref} aria-labelledby={labelledBy}>
      <div className="dlg-in">{children}</div>
    </dialog>
  );
}

/** Cabecera estándar: título + botón (opcional) a la derecha. */
export function DialogHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="dlg-head">
      <h2 id="dlg-title">{title}</h2>
      {children}
    </div>
  );
}
