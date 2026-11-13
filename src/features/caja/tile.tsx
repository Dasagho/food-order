import { useI18n } from "@/i18n";
import { imgSrc } from "@/lib/config";
import { hasHalf } from "@/state/ticket";
import type { MenuItem } from "@/types/order";

/** Ficha de un plato en la Caja: foto, nombre y botones de precio. */
export function Tile({
  product: p,
  full,
  half,
  onAdd,
}: {
  product: MenuItem;
  full: number;
  half: number;
  onAdd: (p: MenuItem, half: boolean) => void;
}) {
  const { t, num, money, dn } = useI18n();
  const racion = p.portionType === "racion";
  const withHalf = hasHalf(p); // sin precio de media ración no se ofrece media
  const nm = dn(p);

  const btn = (isHalf: boolean, label: string, price: number, q: number) => (
    <button
      className={`sell ${q ? "on" : ""}`}
      type="button"
      data-add={p.id}
      data-half={String(isHalf)}
      disabled={!p.available}
      aria-label={t("Cobrar {l} de {p}, {m}", { l: label, p: nm, m: money(price) }) + (q ? ". " + t("Hay {n} en el ticket", { n: num(q) }) : "")}
      onClick={() => onAdd(p, isHalf)}
    >
      <span className="sell-l">{label}</span>
      <span className="sell-p">{money(price)}</span>
      {q > 0 && (
        <span className="sell-q" aria-hidden="true">
          ×{num(q)}
        </span>
      )}
    </button>
  );

  return (
    <li className={`tile ${p.available ? "" : "off"}`}>
      <div className="media">
        <img src={imgSrc(p.image)} alt="" width="400" height="300" loading="lazy" />
      </div>
      <div className="tile-body">
        <h3 className="tile-name">{nm}</h3>
        {p.available ? (
          <div className={`sells ${withHalf ? "two" : ""}`}>
            {btn(false, racion ? (withHalf ? t("Completa") : t("Ración")) : t("Añadir"), p.price, full)}
            {withHalf && btn(true, t("Media"), p.halfPortionPrice as number, half)}
          </div>
        ) : (
          <p className="sold-out">{t("Agotado")}</p>
        )}
      </div>
    </li>
  );
}
