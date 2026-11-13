import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import type { OrderStatus, PaymentMethod } from "@/types/order";

export const PAYMENT_METHODS: PaymentMethod[] = ["efectivo", "tarjeta", "bizum"];
export const STATUSES: OrderStatus[] = ["en_proceso", "completado", "cancelado"];

/** Etiquetas de formas de pago y estados (claves en español, traducidas por t). */
export function useLabels() {
  const { t } = useI18n();
  const pay = (m: string) => t(({ efectivo: "Efectivo", tarjeta: "Tarjeta", bizum: "Bizum" } as Record<string, string>)[m] ?? m);
  const status = (s: string) =>
    t(({ en_proceso: "En proceso", completado: "Cobrada", cancelado: "Anulada" } as Record<string, string>)[s] ?? s);
  return { pay, status };
}

/** Chip de estado: borde + fondo + símbolo (✓ ✕ …) para no depender solo del color. */
export function StatusChip({ status }: { status: OrderStatus }) {
  const { status: label } = useLabels();
  return <span className={`chip ${status}`}>{label(status)}</span>;
}

export function PendingChip() {
  const { t } = useI18n();
  return <span className="chip pending">{t("Pendiente")}</span>;
}

export function Skeletons({ n, label }: { n: number; label?: string }) {
  return (
    <div className="skel-grid" aria-busy="true" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Interruptor accesible (role="switch" + aria-checked). */
export function Switch({
  checked,
  onChange,
  children,
  disabled,
  ...rest
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  disabled?: boolean;
} & Record<string, unknown>) {
  return (
    <button className="switch" type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange} {...rest}>
      <span className="dot" aria-hidden="true" />
      {children}
    </button>
  );
}
