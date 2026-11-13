import { useMemo, useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { useI18n } from "@/i18n";
import { useCatalog } from "@/state/catalog";
import { hasHalf } from "@/state/ticket";
import { imgSrc } from "@/lib/config";
import type { MenuItem } from "@/types/order";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Selector de plato con búsqueda para AÑADIR productos a un pedido ya creado (SPEC §8.1).
 * Entera / media (solo si el plato tiene precio de media ración); los platos agotados se ven
 * pero no se pueden añadir. No se cierra al elegir: se pueden añadir varios y se pulsa «Listo».
 */
export function ProductPicker({
  onPick,
  onClose,
  countOf,
}: {
  onPick: (p: MenuItem, half: boolean) => void;
  onClose: () => void;
  /** Cuántas unidades hay ya en el pedido (para mostrarlo). */
  countOf?: (p: MenuItem, half: boolean) => number;
}) {
  const { t, num, money, dn } = useI18n();
  const { products, categories } = useCatalog();
  const [q, setQ] = useState("");
  const [last, setLast] = useState("");

  const list = useMemo(() => {
    const f = fold(q.trim());
    return products.filter((p) => !f || fold(p.name).includes(f) || fold(p.names?.ar ?? "").includes(f));
  }, [products, q]);
  const catName = (id: string) => dn(categories.find((c) => c.id === id)) || t("Sin sección");

  const pick = (p: MenuItem, half: boolean) => {
    onPick(p, half);
    setLast(t("Añadido: {p}", { p: dn(p) + (half ? ` ${t("(media)")}` : "") }));
  };

  return (
    <Dialog onClose={onClose}>
      <DialogHead title={t("Añadir un plato")}>
        <button className="btn plain small" type="button" onClick={onClose}>
          {t("Listo")}
        </button>
      </DialogHead>
      <div className="field search">
        <label htmlFor="pick-q">{t("Buscar plato")}</label>
        <input
          id="pick-q"
          className="input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          data-autofocus
        />
      </div>
      <p className="soft" role="status" aria-live="polite">
        {last}
      </p>
      {list.length === 0 ? (
        <div className="empty">
          <strong>{t("Ningún plato coincide")}</strong>
        </div>
      ) : (
        <ul className="pick-list">
          {list.map((p) => {
            const half = hasHalf(p);
            const nm = dn(p);
            const n1 = countOf?.(p, false) ?? 0;
            const n2 = countOf?.(p, true) ?? 0;
            return (
              <li key={p.id} className={`pick ${p.available ? "" : "off"}`}>
                <div className="thumb">
                  <img src={imgSrc(p.image)} alt="" width="64" height="64" loading="lazy" />
                </div>
                <div className="main">
                  <span className="title">{nm}</span>
                  <span className="meta">{catName(p.category)}</span>
                  {p.available ? (
                    <div className="actions">
                      <button
                        className="btn primary small"
                        type="button"
                        data-pick={p.id}
                        data-half="false"
                        aria-label={t("Añadir {l} de {p}, {m}", {
                          l: half ? t("Completa") : p.portionType === "racion" ? t("Ración") : t("Añadir"),
                          p: nm,
                          m: money(p.price),
                        })}
                        onClick={() => pick(p, false)}
                      >
                        {half ? t("Completa") : p.portionType === "racion" ? t("Ración") : t("Añadir")} · {money(p.price)}
                        {n1 ? ` ×${num(n1)}` : ""}
                      </button>
                      {half && (
                        <button
                          className="btn primary small"
                          type="button"
                          data-pick={p.id}
                          data-half="true"
                          aria-label={t("Añadir {l} de {p}, {m}", { l: t("Media"), p: nm, m: money(p.halfPortionPrice as number) })}
                          onClick={() => pick(p, true)}
                        >
                          {t("Media")} · {money(p.halfPortionPrice as number)}
                          {n2 ? ` ×${num(n2)}` : ""}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="sold-out">{t("Agotado")}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
