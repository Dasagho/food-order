import { useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { Switch } from "@/ui/parts";
import { useToast } from "@/ui/toast";
import { useI18n } from "@/i18n";
import { useCatalog } from "@/state/catalog";
import { saveProduct, uploadImage } from "@/lib/product-storage";
import { imgSrc } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { amountOk, parseAmount } from "@/features/shared/format";
import type { MenuItem } from "@/types/order";

const MAX_BYTES = 5 * 1024 * 1024;

/** Alta/edición de un plato: validación al salir de cada campo, máximo 2 decimales, subida de foto con vista previa. */
export function ProductForm({ product: p, defaultCategory, onClose }: { product: MenuItem | null; defaultCategory?: string; onClose: () => void }) {
  const { t, dn } = useI18n();
  const { toast } = useToast();
  const { categories } = useCatalog();
  const [name, setName] = useState(p?.name ?? "");
  const [ar, setAr] = useState(p?.names?.ar ?? "");
  const [cat, setCat] = useState(p?.category ?? defaultCategory ?? categories[0]?.id ?? "");
  const [type, setType] = useState<"racion" | "unidades">(p?.portionType ?? "racion");
  const [price, setPrice] = useState(p ? String(p.price) : "");
  const [half, setHalf] = useState(p?.halfPortionPrice != null ? String(p.halfPortionPrice) : "");
  const [available, setAvailable] = useState(p ? p.available !== false : true);
  const [image, setImage] = useState(p?.image ?? "");
  const [uploading, setUploading] = useState(false);
  const [imgHelp, setImgHelp] = useState(t("Máximo 5 MB."));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const racion = type === "racion";

  const check = {
    name: () => (name.trim() ? "" : t("Falta el nombre.")),
    price: () => {
      const v = parseAmount(price);
      if (amountOk(v)) return "";
      return v !== null && Number.isFinite(v) && v >= 0 ? t("Importe no válido. Usa como máximo 2 decimales.") : t("Falta el precio (ej. 4,50).");
    },
    half: () => (half.trim() === "" || amountOk(parseAmount(half)) ? "" : t("Importe no válido. Usa como máximo 2 decimales.")),
  };
  const validate = (k: keyof typeof check) => {
    const m = check[k]();
    setErrs((e) => ({ ...e, [k]: m }));
    return !m;
  };

  const onFile = async (f: File | undefined, input: HTMLInputElement) => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setErrs((e) => ({ ...e, img: t("La foto pesa más de 5 MB.") }));
      input.value = "";
      return;
    }
    setErrs((e) => ({ ...e, img: "" }));
    setUploading(true);
    setImgHelp(t("Subiendo la foto…"));
    try {
      setImage(await uploadImage(f));
      setImgHelp(t("Foto lista."));
    } catch (er) {
      setErrs((e) => ({ ...e, img: errorMessage(er) }));
      setImgHelp(t("Máximo 5 MB."));
    }
    setUploading(false);
  };

  const save = async () => {
    if (saving) return;
    const ok = [validate("name"), validate("price"), validate("half")].every(Boolean);
    setErrs((e) => ({ ...e, img: image ? "" : t("Falta la foto.") }));
    if (!ok || !image) return;
    if (uploading) {
      setFormErr(t("Espera, se está subiendo la foto."));
      return;
    }
    setSaving(true);
    setFormErr("");
    try {
      await saveProduct({
        id: p?.id,
        name,
        names: ar.trim() ? { ar: ar.trim() } : {},
        category: cat,
        portionType: type,
        price: parseAmount(price) as number,
        halfPortionPrice: racion && half.trim() !== "" ? (parseAmount(half) as number) : undefined,
        image,
        available,
      });
      toast(p ? t("Plato guardado.") : t("Plato creado."), "ok");
      onClose();
    } catch (e) {
      setSaving(false);
      setFormErr(errorMessage(e));
    }
  };

  const err = (k: string, id: string) => (
    <span className="error" id={id} role="alert">
      {errs[k]}
    </span>
  );

  return (
    <Dialog onClose={() => !saving && onClose()}>
      <DialogHead title={p ? t("Editar plato") : t("Nuevo plato")}>
        <button className="btn plain small" type="button" onClick={onClose} disabled={saving}>
          {t("Cerrar")}
        </button>
      </DialogHead>
      <p className="soft">{t("{s} = obligatorio", { s: "*" })}</p>
      <div className="field">
        <label htmlFor="f-name">
          {t("Nombre (español)")} <span className="req" aria-hidden="true">*</span>
        </label>
        <input className="input" id="f-name" value={name} autoComplete="off" lang="es" dir="ltr" aria-describedby="e-name" aria-invalid={errs.name ? true : undefined} onChange={(e) => setName(e.target.value)} onBlur={() => validate("name")} />
        {err("name", "e-name")}
      </div>
      <div className="field">
        <label htmlFor="f-name-ar">
          {t("Nombre (árabe)")} <span className="soft">{t("(opcional)")}</span>
        </label>
        <input className="input" id="f-name-ar" value={ar} autoComplete="off" lang="ar" dir="rtl" onChange={(e) => setAr(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="f-cat">
          {t("Sección del menú")} <span className="req" aria-hidden="true">*</span>
        </label>
        <select className="input" id="f-cat" value={cat} onChange={(e) => setCat(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {dn(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="f-type">{t("¿Cómo se vende?")}</label>
        <select className="input" id="f-type" value={type} onChange={(e) => setType(e.target.value as "racion" | "unidades")}>
          <option value="racion">{t("Por raciones")}</option>
          <option value="unidades">{t("Por unidades")}</option>
        </select>
      </div>
      <div className="two">
        <div className="field">
          <label htmlFor="f-price">
            {racion ? t("Precio ración") : t("Precio unidad")} (€) <span className="req" aria-hidden="true">*</span>
          </label>
          <input className="input" id="f-price" type="number" inputMode="decimal" min="0" step="0.01" dir="ltr" value={price} aria-describedby="e-price" aria-invalid={errs.price ? true : undefined} onChange={(e) => setPrice(e.target.value)} onBlur={() => validate("price")} />
          {err("price", "e-price")}
        </div>
        {racion && (
          <div className="field" id="g-half">
            <label htmlFor="f-half">{t("Precio media ración (€)")}</label>
            <input className="input" id="f-half" type="number" inputMode="decimal" min="0" step="0.01" dir="ltr" value={half} aria-describedby="h-half e-half" aria-invalid={errs.half ? true : undefined} onChange={(e) => setHalf(e.target.value)} onBlur={() => validate("half")} />
            <span className="help" id="h-half">
              {t("Vacío = sin media ración.")}
            </span>
            {err("half", "e-half")}
          </div>
        )}
      </div>
      <div className="field">
        <span className="label">{t("Disponibilidad")}</span>
        <Switch checked={available} onChange={() => setAvailable(!available)}>
          {available ? t("Disponible") : t("Agotado")}
        </Switch>
      </div>
      <div className="field">
        <span className="label">
          {t("Foto del plato")} <span className="req" aria-hidden="true">*</span>
        </span>
        {image && <img className="preview" id="f-prev" alt={t("Vista previa de la foto")} src={imgSrc(image)} />}
        <input className="input" id="f-file" type="file" accept="image/jpeg,image/png,image/webp" aria-label={t("Elegir foto")} aria-describedby="e-img h-img" onChange={(e) => onFile(e.target.files?.[0], e.target)} />
        <span className="help" id="h-img">
          {imgHelp}
        </span>
        {err("img", "e-img")}
      </div>
      <p className="error" role="alert">
        {formErr}
      </p>
      <div className="dlg-foot">
        <button className="btn plain" type="button" onClick={onClose} disabled={saving}>
          {t("Cancelar")}
        </button>
        <button className="btn primary" type="button" id="f-save" onClick={save} disabled={saving}>
          {saving ? t("Guardando…") : p ? t("Guardar") : t("Crear")}
        </button>
      </div>
    </Dialog>
  );
}
