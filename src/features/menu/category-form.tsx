import { useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { useToast } from "@/ui/toast";
import { useI18n } from "@/i18n";
import { saveCategory } from "@/lib/product-storage";
import { errorMessage } from "@/lib/errors";
import type { Category } from "@/types/order";

export function CategoryForm({ category: c, onClose }: { category: Category | null; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState(c?.name ?? "");
  const [ar, setAr] = useState(c?.names?.ar ?? "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      setErr(t("Falta el nombre."));
      return;
    }
    setSaving(true);
    try {
      await saveCategory({ id: c?.id, name, ar });
      toast(t("Sección guardada."), "ok");
      onClose();
    } catch (e) {
      setSaving(false);
      setErr(errorMessage(e));
    }
  };

  return (
    <Dialog onClose={() => !saving && onClose()}>
      <DialogHead title={c ? t("Cambiar nombre") : t("Nueva sección")} />
      <div className="field">
        <label htmlFor="c-name">
          {t("Nombre (español)")} <span className="req" aria-hidden="true">*</span>
        </label>
        <input
          className="input"
          id="c-name"
          value={name}
          autoComplete="off"
          lang="es"
          dir="ltr"
          aria-describedby="e-cname"
          aria-invalid={err ? true : undefined}
          data-autofocus
          onChange={(e) => {
            setName(e.target.value);
            setErr("");
          }}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <span className="help">{t("Ej.: Entrantes, Postres.")}</span>
        <span className="error" id="e-cname" role="alert">
          {err}
        </span>
      </div>
      <div className="field">
        <label htmlFor="c-name-ar">
          {t("Nombre (árabe)")} <span className="soft">{t("(opcional)")}</span>
        </label>
        <input className="input" id="c-name-ar" value={ar} autoComplete="off" lang="ar" dir="rtl" onChange={(e) => setAr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </div>
      <div className="dlg-foot">
        <button className="btn plain" type="button" onClick={onClose} disabled={saving}>
          {t("Cancelar")}
        </button>
        <button className="btn primary" type="button" onClick={save} disabled={saving}>
          {saving ? t("Guardando…") : t("Guardar")}
        </button>
      </div>
    </Dialog>
  );
}
