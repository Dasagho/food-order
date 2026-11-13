import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { readCatalogCache, refreshCatalog, subscribeCatalog, type Catalog } from "@/lib/product-storage";
import { errorMessage, isOfflineError } from "@/lib/errors";
import type { Category, MenuItem } from "@/types/order";
import { ApiError } from "@/lib/api";

interface CatalogValue {
  status: "loading" | "ok" | "error";
  products: MenuItem[];
  categories: Category[];
  error: string;
  reload: () => void;
}
const Ctx = createContext<CatalogValue | null>(null);

/**
 * Catálogo para toda la app: la caché de IndexedDB primero (la Caja abre sin red) y luego el
 * servidor. Solo hay error si no hay caché y el servidor no responde.
 */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<CatalogValue["status"]>("loading");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    let alive = true;
    setError("");
    readCatalogCache()
      .catch(() => null)
      .then((cached) => {
        if (!alive) return;
        if (cached) {
          setCat((c) => c ?? cached);
          setStatus("ok");
        } else setStatus("loading");
        return refreshCatalog()
          .then((fresh) => {
            if (!alive) return;
            setCat(fresh);
            setStatus("ok");
          })
          .catch((e) => {
            if (!alive || cached) return;
            setStatus("error");
            setError(e instanceof ApiError && isOfflineError(e) ? errorMessage(e) : errorMessage(e));
          });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const stop = load();
    const off = subscribeCatalog((c) => {
      setCat(c);
      setStatus("ok");
    });
    return () => {
      stop();
      off();
    };
  }, [load]);

  const value = useMemo<CatalogValue>(
    () => ({
      status,
      products: cat?.products ?? [],
      categories: cat?.categories ?? [],
      error,
      reload: () => {
        setStatus("loading");
        load();
      },
    }),
    [cat, status, error, load],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalog(): CatalogValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCatalog debe usarse dentro de <CatalogProvider>");
  return c;
}
