import { useState } from "react";
import { useI18n } from "@/i18n";
import { useCatalog } from "@/state/catalog";
import { useTicket } from "@/state/ticket";
import { useConfirm } from "@/ui/confirm";
import { useToast } from "@/ui/toast";
import { useOnline } from "@/state/use-online";
import { Empty, Skeletons, Switch } from "@/ui/parts";
import { useOutboxState } from "@/lib/sync/use-outbox";
import { useAuth } from "@/lib/auth/auth-context";
import { deleteCategory, deleteProduct, reorderCategories, reorderProducts, setAvailability } from "@/lib/product-storage";
import { imgSrc } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import type { Category, MenuItem } from "@/types/order";
import { ProductForm } from "./product-form";
import { CategoryForm } from "./category-form";

type Tab = "platos" | "categorias";

export default function MenuPage() {
  const { t, plural, money, dn } = useI18n();
  const catalog = useCatalog();
  const confirm = useConfirm();
  const { toast } = useToast();
  const tk = useTicket();
  const online = useOnline();
  const q = useOutboxState();
  const { logout } = useAuth();
  const [tab, setTab] = useState<Tab>("platos");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState<null | { product: MenuItem | null }>(null);
  const [catForm, setCatForm] = useState<null | { category: Category | null }>(null);
  const dis = !online; // sin conexión no se edita el menú
  const needNet = () => {
    if (online) return true;
    toast(t("Necesitas conexión para esto."), "error");
    return false;
  };

  const doLogout = async () => {
    if (q.pending) {
      const ok = await confirm({
        title: t("¿Salir ahora?"),
        text: t("Hay {n} sin enviar. Se enviarán cuando vuelvas a entrar.", { n: plural(q.pending, "pedido") }),
        ok: t("Sí, salir"),
      });
      if (!ok) return;
    }
    tk.exitEdit();
    await logout();
    toast(t("Sesión cerrada."));
  };

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    try {
      await fn();
      if (okMsg) toast(okMsg, "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  // Subir/Bajar: se envía SIEMPRE la lista exacta de ids no borrados (un cambio de orden dentro del filtro intercambia vecinos visibles)
  const move = async (kind: "p" | "c", id: string, dir: "up" | "down") => {
    if (!needNet()) return;
    const all: { id: string; category?: string }[] = kind === "p" ? catalog.products : catalog.categories;
    const ids = all.map((x) => x.id);
    const visible = kind === "p" && filter !== "all" ? catalog.products.filter((p) => p.category === filter).map((p) => p.id) : ids;
    const vi = visible.indexOf(id);
    const ni = dir === "up" ? vi - 1 : vi + 1;
    if (ni < 0 || ni >= visible.length) return;
    const a = ids.indexOf(id);
    const b = ids.indexOf(visible[ni]);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    try {
      await (kind === "p" ? reorderProducts(ids) : reorderCategories(ids));
      toast(t("Orden guardado."), "ok");
    } catch (e) {
      // reorder_mismatch: el menú cambió en otro sitio; se recarga y se pide repetir
      if ((e as { code?: string })?.code === "reorder_mismatch") catalog.reload();
      toast(errorMessage(e), "error");
    }
  };

  const delProduct = async (p: MenuItem) => {
    if (!needNet()) return;
    const ok = await confirm({
      title: t("¿Borrar «{p}»?", { p: dn(p) }),
      text: t("Desaparecerá del menú. Si solo se acabó hoy, márcalo como «Agotado»."),
      ok: t("Sí, borrar"),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await deleteProduct(p.id);
      tk.removeProduct(p.id);
    }, t("Plato borrado."));
  };

  const delCategory = async (c: Category) => {
    if (!needNet()) return;
    const ok = await confirm({ title: t("¿Borrar la sección «{p}»?", { p: dn(c) }), text: t("Debe estar vacía."), ok: t("Sí, borrar"), danger: true });
    if (!ok) return;
    await run(async () => {
      await deleteCategory(c.id);
      if (filter === c.id) setFilter("all");
      if (tk.cat === c.id) tk.setCat("all");
    }, t("Sección borrada."));
  };

  const toggleAvail = async (p: MenuItem) => {
    if (!needNet()) return;
    await run(async () => {
      await setAvailability(p.id, !p.available);
    }, p.available ? t("«{p}»: agotado.", { p: dn(p) }) : t("«{p}»: disponible.", { p: dn(p) }));
  };

  const catName = (id: string) => dn(catalog.categories.find((c) => c.id === id)) || t("Sin sección");

  let content;
  if (catalog.status === "loading") content = <Skeletons n={8} label={t("Cargando")} />;
  else if (catalog.status === "error")
    content = (
      <div className="state">
        <h2>{t("No se pudo cargar el menú")}</h2>
        <p className="soft">{catalog.error}</p>
        <button className="btn primary big" type="button" onClick={catalog.reload}>
          {t("Reintentar")}
        </button>
      </div>
    );
  else if (tab === "platos") {
    const list = catalog.products.filter((p) => filter === "all" || p.category === filter);
    content = (
      <>
        <div style={{ marginBottom: 16 }}>
          <button className="btn primary" type="button" disabled={dis} onClick={() => catalog.categories.length ? setForm({ product: null }) : toast(t("Crea antes una sección."), "error")}>
            {t("+ Plato nuevo")}
          </button>
        </div>
        <div className="cats" role="group" aria-label={t("Filtrar por sección")}>
          <button className="cat" type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            {t("Todos")}
          </button>
          {catalog.categories.map((c) => (
            <button key={c.id} className="cat" type="button" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
              {dn(c)}
            </button>
          ))}
        </div>
        {list.length ? (
          <ul className="admin-list">
            {list.map((p, i) => (
              <li key={p.id} className={`arow ${p.available ? "" : "off"}`} data-product={p.id}>
                <div className="thumb">
                  <img src={imgSrc(p.image)} alt="" width="80" height="80" loading="lazy" />
                </div>
                <div className="main">
                  <span className="title">{dn(p)}</span>
                  <span className="meta">
                    {catName(p.category)} ·{" "}
                    {p.portionType === "racion"
                      ? `${t("Ración {m}", { m: money(p.price) })}${p.halfPortionPrice != null ? ` · ${t("Media {m}", { m: money(p.halfPortionPrice) })}` : ""}`
                      : t("{m} la unidad", { m: money(p.price) })}
                  </span>
                  <div className="actions">
                    <Switch checked={p.available ?? true} disabled={dis} onChange={() => toggleAvail(p)}>
                      {p.available ?? true ? t("Disponible") : t("Agotado")}
                    </Switch>
                    <button className="btn plain small" type="button" disabled={dis} onClick={() => needNet() && setForm({ product: p })}>
                      {t("Editar")}
                    </button>
                    <button className="btn plain small" type="button" disabled={i === 0 || dis} aria-label={t("Subir {p} en el menú", { p: dn(p) })} onClick={() => move("p", p.id, "up")}>
                      {t("Subir")}
                    </button>
                    <button className="btn plain small" type="button" disabled={i === list.length - 1 || dis} aria-label={t("Bajar {p} en el menú", { p: dn(p) })} onClick={() => move("p", p.id, "down")}>
                      {t("Bajar")}
                    </button>
                    <button className="btn danger small" type="button" disabled={dis} onClick={() => delProduct(p)}>
                      {t("Borrar")}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title={t("Sin platos aquí")}>{t("Crea el primero con «+ Plato nuevo».")}</Empty>
        )}
      </>
    );
  } else {
    const list = catalog.categories;
    content = (
      <>
        <div style={{ marginBottom: 16 }}>
          <button className="btn primary" type="button" disabled={dis} onClick={() => setCatForm({ category: null })}>
            {t("+ Sección nueva")}
          </button>
        </div>
        {list.length ? (
          <ul className="admin-list">
            {list.map((c, i) => (
              <li key={c.id} className="arow cat-row" data-category={c.id}>
                <div className="main">
                  <span className="title">{dn(c)}</span>
                  <span className="meta">{plural(catalog.products.filter((p) => p.category === c.id).length, "plato")}</span>
                  <div className="actions">
                    <button className="btn plain small" type="button" disabled={dis} onClick={() => setCatForm({ category: c })}>
                      {t("Cambiar nombre")}
                    </button>
                    <button className="btn plain small" type="button" disabled={i === 0 || dis} aria-label={t("Subir {p}", { p: dn(c) })} onClick={() => move("c", c.id, "up")}>
                      {t("Subir")}
                    </button>
                    <button className="btn plain small" type="button" disabled={i === list.length - 1 || dis} aria-label={t("Bajar {p}", { p: dn(c) })} onClick={() => move("c", c.id, "down")}>
                      {t("Bajar")}
                    </button>
                    <button className="btn danger small" type="button" disabled={dis} onClick={() => delCategory(c)}>
                      {t("Borrar")}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title={t("Sin secciones")}>{t("Crea una, por ejemplo «Entrantes».")}</Empty>
        )}
      </>
    );
  }

  return (
    <>
      <h1 style={{ marginBottom: 16 }}>{t("Menú")}</h1>
      <div className="subtabs" role="group" aria-label={t("Qué quieres gestionar")}>
        <button className={`btn ${tab === "platos" ? "primary" : "plain"}`} type="button" aria-pressed={tab === "platos"} onClick={() => setTab("platos")}>
          {t("Platos")}
        </button>
        <button className={`btn ${tab === "categorias" ? "primary" : "plain"}`} type="button" aria-pressed={tab === "categorias"} onClick={() => setTab("categorias")}>
          {t("Secciones")}
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn plain small" type="button" onClick={doLogout}>
          {t("Salir")}
        </button>
      </div>
      {dis && (
        <p className="notice warn" role="status">
          <span>{t("Sin conexión: para cambiar el menú hace falta internet.")}</span>
        </p>
      )}
      {content}
      {form && <ProductForm product={form.product} defaultCategory={filter !== "all" ? filter : undefined} onClose={() => setForm(null)} />}
      {catForm && <CategoryForm category={catForm.category} onClose={() => setCatForm(null)} />}
    </>
  );
}
