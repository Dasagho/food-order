import { describe, it, expect, vi } from "vitest";
import { boot } from "./helpers";
import { FakeApi, TEST_SEED } from "../fake-api/fake-api";
import type { ProductDraft } from "@/types/order";

const draft = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  name: "Plato nuevo",
  price: 2,
  image: "/x.jpg",
  category: "entrantes",
  portionType: "unidades",
  ...over,
});

describe("catálogo: el servidor manda, IndexedDB guarda una caché", () => {
  it("la primera lectura trae el catálogo del servidor y lo mapea al modelo del cliente", async () => {
    const { products } = await boot();
    const list = await products.getProducts();
    expect(list.map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
    expect(list[0]).toEqual({
      id: "1",
      name: "Paella Valenciana",
      names: {},
      price: 4.5,
      halfPortionPrice: 3,
      image: "/paella-valenciana.jpg",
      category: "arroces",
      portionType: "racion",
      displayOrder: 0,
      available: true,
    });
    expect((await products.getCategories()).map((c) => c.id)).toEqual([
      "arroces",
      "entrantes",
      "principales",
      "bebidas",
      "postres",
    ]);
  });

  it("deja una caché en el almacén `catalog` y sin conexión se trabaja con ella", async () => {
    const { products, ctl, api } = await boot();
    await products.getProducts();
    vi.resetModules();
    ctl.down = true;
    const again = await import("@/lib/product-storage");
    const calls = ctl.calls;
    expect((await again.getProducts()).map((p) => p.id)).toEqual(["1", "2", "3", "4"]);
    expect(ctl.calls).toBe(calls); // cache-first: no espera a la red
    expect((await again.getCategories()).length).toBe(5);
    void api;
  });

  it("sin caché y sin conexión no hay menú: lanza el error (la UI avisa)", async () => {
    const { products, ctl } = await boot();
    ctl.down = true;
    await expect(products.getProducts()).rejects.toMatchObject({ code: "network_error" });
  });

  it("refreshCatalog actualiza la caché y avisa a los suscriptores", async () => {
    const { products, api } = await boot();
    await products.getProducts();
    const seen: number[] = [];
    products.subscribeCatalog((c) => seen.push(c.products.length));
    await api.handle({
      method: "POST",
      url: "/v1/products",
      headers: { authorization: `Bearer ${[...(api as any).accessTokens.keys()][0]}` },
      body: { name: "Otro", categoryId: "postres", portionType: "unidades", price: 1, imageUrl: "/o.jpg" },
    });
    await products.refreshCatalog();
    expect(seen).toEqual([5]);
    expect((await products.getProducts()).map((p) => p.name)).toContain("Otro");
  });

  it("los productos borrados no aparecen", async () => {
    const { products } = await boot();
    await products.deleteProduct("1");
    const ids = (await products.getProducts()).map((p) => p.id);
    expect(ids).not.toContain("1");
    expect(ids).toHaveLength(3);
  });
});

describe("catálogo: edición (requiere conexión)", () => {
  it("saveProduct sin id crea el producto (el id lo genera el servidor)", async () => {
    const { products, api } = await boot();
    await products.saveProduct(draft({ name: "Tortilla", price: 3.25 }));
    const post = api.log.find((l) => l.method === "POST" && l.path === "/v1/products")!;
    expect(post.body).toEqual({
      name: "Tortilla",
      names: {},
      categoryId: "entrantes",
      portionType: "unidades",
      price: 3.25,
      imageUrl: "/x.jpg",
      available: true,
    });
    const list = await products.getProducts();
    expect(list.at(-1)).toMatchObject({ name: "Tortilla", price: 3.25 });
    expect(list.at(-1)!.id).toMatch(/^p-/);
  });

  it("saveProduct con id actualiza (PATCH) sin duplicar", async () => {
    const { products, api } = await boot();
    const first = (await products.getProducts())[0];
    await products.saveProduct({ ...first, name: "Renombrado", price: 9.99 });
    const patch = api.log.find((l) => l.method === "PATCH")!;
    expect(patch.path).toBe("/v1/products/1");
    expect(patch.body).toMatchObject({ name: "Renombrado", price: 9.99, halfPortionPrice: 3 });
    const list = await products.getProducts();
    expect(list).toHaveLength(4);
    expect(list.find((p) => p.id === "1")).toMatchObject({ name: "Renombrado", price: 9.99 });
  });

  it("pasar a 'unidades' borra la media ración (null) y las raciones sin media no la ofrecen", async () => {
    const { products, api } = await boot();
    const first = (await products.getProducts())[0];
    await products.saveProduct({ ...first, portionType: "unidades" });
    expect(api.log.find((l) => l.method === "PATCH")!.body.halfPortionPrice).toBeNull();
    await products.saveProduct(draft({ portionType: "racion", price: 5 }));
    const created = (await products.getProducts()).at(-1)!;
    expect(created.halfPortionPrice).toBeUndefined();
  });

  it("los importes se envían redondeados a 2 decimales", async () => {
    const { products, api } = await boot();
    await products.saveProduct(draft({ price: 2.3 * 3 })); // 6.8999999…
    expect(api.log.find((l) => l.method === "POST" && l.path === "/v1/products")!.body.price).toBe(6.9);
  });

  it("reorderProducts envía la lista EXACTA de ids no borrados y la caché refleja el orden", async () => {
    const { products, api } = await boot();
    await products.reorderProducts(["4", "3", "2", "1"]);
    expect(api.log.find((l) => l.path === "/v1/products/reorder")!.body).toEqual({ ids: ["4", "3", "2", "1"] });
    expect((await products.getProducts()).map((p) => p.id)).toEqual(["4", "3", "2", "1"]);
  });

  it("409 reorder_mismatch si la lista no coincide (otro dispositivo cambió el menú)", async () => {
    const { products } = await boot();
    await expect(products.reorderProducts(["4", "3"])).rejects.toMatchObject({ status: 409, code: "reorder_mismatch" });
  });

  it("uploadImage sube el fichero a /uploads y devuelve la URL", async () => {
    const { products, api } = await boot();
    const url = await products.uploadImage(new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    expect(url).toMatch(/^\/v1\/uploads\/img-/);
    expect(api.log.find((l) => l.path === "/v1/uploads")!.method).toBe("POST");
  });

  it("imgSrc antepone VITE_API_URL solo a las rutas /v1/ (las del despliegue no cambian)", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.ejemplo.es");
    vi.resetModules();
    const { imgSrc } = await import("@/lib/config");
    expect(imgSrc("/v1/uploads/a.png")).toBe("https://api.ejemplo.es/v1/uploads/a.png");
    expect(imgSrc("/paella.jpg")).toBe("/paella.jpg");
    expect(imgSrc("https://x/y.png")).toBe("https://x/y.png");
    expect(imgSrc("")).toBe("/placeholder.svg");
    vi.unstubAllEnvs();
  });
});

describe("catálogo: la semilla de prueba", () => {
  it("el FakeApi vacío no inventa productos", async () => {
    const { products } = await boot(new FakeApi({}));
    expect(await products.getProducts()).toEqual([]);
    void TEST_SEED;
  });
});
