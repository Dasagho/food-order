import { useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { useI18n } from "@/i18n";
import { amountOk, parseAmount } from "@/features/shared/format";
import { toCents } from "@/lib/mapping";
import type { OrderItem } from "@/types/order";

/** Precio de una línea del ticket (se guarda unitPrice = lo cobrado y listPrice = el de carta). */
export function PriceDialog({
  line,
  onSave,
  onClose,
}: {
  line: OrderItem;
  onSave: (price: number) => void;
  onClose: () => void;
}) {
  const { t, money, dn } = useI18n();
  const [value, setValue] = useState(String(line.price));
  const [err, setErr] = useState("");
  const differs = line.listPrice != null && toCents(line.listPrice) !== toCents(line.price);

  const save = (reset: boolean) => {
    if (reset) return onSave(line.listPrice as number);
    const v = parseAmount(value);
    if (!amountOk(v)) {
      setErr(t("Importe no válido. Usa como máximo 2 decimales."));
      return;
    }
    onSave(v);
  };

  return (
    <Dialog onClose={onClose}>
      <DialogHead title={t("Precio de {p}", { p: dn(line) })}>
        <button className="btn plain small" type="button" onClick={onClose}>
          {t("Cerrar")}
        </button>
      </DialogHead>
      <div className="field">
        <label htmlFor="pr-v">{t("Precio de cada uno (€)")}</label>
        <input
          className="input"
          id="pr-v"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          dir="ltr"
          value={value}
          aria-describedby="pr-h pr-e"
          aria-invalid={err ? true : undefined}
          data-autofocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setValue(e.target.value);
            setErr("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save(false);
            }
          }}
        />
        <span className="help" id="pr-h">
          {line.listPrice != null ? t("Precio de la carta: {m}", { m: money(line.listPrice) }) : ""}
        </span>
        <span className="error" id="pr-e" role="alert">
          {err}
        </span>
      </div>
      <div className="dlg-foot">
        {differs && (
          <button className="btn plain" type="button" onClick={() => save(true)}>
            {t("Usar el de la carta")}
          </button>
        )}
        <button className="btn plain" type="button" onClick={onClose}>
          {t("Cancelar")}
        </button>
        <button className="btn primary" type="button" onClick={() => save(false)}>
          {t("Guardar")}
        </button>
      </div>
    </Dialog>
  );
}
