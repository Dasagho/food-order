import { describe, it, expect, vi } from "vitest";
import { menuItems as defaults } from "@/data/menu-items";
import { loadStorage, seedLegacyProducts, seedLegacyCategories } from "./helpers";
import type { MenuItem } from "@/types/order";

const prod = (over: Partial<MenuItem> = {}): MenuItem => ({
  id: "x1",
  name: "Plato nuevo",
  price: 2,
  image: "",
  category: "entrantes",
  portionType: "unidades",
  ...over,
});

describe("product-storage: productos", () => {
  it("la primera lectura devuelve el menú por defecto", async () => {
    const { products } = await loadStorage();
    const list = await products.getProducts();
    expect(list.map((p) => p.id)).toEqual(defaults.map((p) => p.id));
  });

  it("saveProduct crea un producto nuevo", async () => {
    const { products } = await loadStorage();
    await products.saveProduct(prod({ id: "nuevo" }));
    const list = await products.getProducts();
    expect(list).toHaveLength(defaults.length + 1);
    expect(list.at(-1)).toMatchObject({ id: "nuevo", name: "Plato nuevo" });
  });

  it("saveProduct con id existente actualiza sin duplicar", async () => {
    const { products } = await loadStorage();
    const first = (await products.getProducts())[0];
    await products.saveProduct({ ...first, name: "Renombrado", price: 9.99 });
    const list = await products.getProducts();
    expect(list).toHaveLength(defaults.length);
    expect(list.find((p) => p.id === first.id)).toMatchObject({ name: "Renombrado", price: 9.99 });
  });

  it("deleteProduct elimina solo ese producto", async () => {
    const { products } = await loadStorage();
    await products.deleteProduct(defaults[0].id);
    const ids = (await products.getProducts()).map((p) => p.id);
    expect(ids).not.toContain(defaults[0].id);
    expect(ids).toHaveLength(defaults.length - 1);
  });

  it("borrar todos los productos NO vuelve a sembrar los de por defecto", async () => {
    const { products } = await loadStorage();
    for (const p of await products.getProducts()) await products.deleteProduct(p.id);
    expect(await products.getProducts()).toEqual([]);
    vi.resetModules();
    const again = await loadStorage();
    expect(await again.products.getProducts()).toEqual([]);
  });

  it("updateProductOrder persiste el nuevo orden y los displayOrder", async () => {
    const { products } = await loadStorage();
    const reordered = (await products.getProducts())
      .slice()
      .reverse()
      .map((p, i) => ({ ...p, displayOrder: i }));
    await products.updateProductOrder(reordered);
    vi.resetModules();
    const again = await loadStorage();
    const list = await again.products.getProducts();
    expect(list.map((p) => p.id)).toEqual(reordered.map((p) => p.id));
    expect(list.map((p) => p.displayOrder)).toEqual(reordered.map((p) => p.displayOrder));
  });

  it("los cambios persisten tras reiniciar la app", async () => {
    const a = await loadStorage();
    await a.products.saveProduct(prod({ id: "persist" }));
    vi.resetModules();
    const b = await loadStorage();
    expect((await b.products.getProducts()).some((p) => p.id === "persist")).toBe(true);
  });

  it("respeta el menú personalizado existente y NO lo pisa con los defaults", async () => {
    seedLegacyProducts([prod({ id: "custom1", name: "Mi plato" })]);
    const { products } = await loadStorage();
    const list = await products.getProducts();
    expect(list.map((p) => p.id)).toEqual(["custom1"]);
  });
});

describe("product-storage: categorías", () => {
  it("la primera lectura devuelve las 5 categorías por defecto en orden", async () => {
    const { products } = await loadStorage();
    const cats = await products.getCategories();
    expect(cats.map((c) => c.id)).toEqual([
      "arroces",
      "entrantes",
      "principales",
      "bebidas",
      "postres",
    ]);
    expect(cats.map((c) => c.displayOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it("saveCategory crea y actualiza", async () => {
    const { products } = await loadStorage();
    await products.saveCategory({ id: "arroces", name: "Arroces!", displayOrder: 1 });
    const cats = await products.getCategories();
    expect(cats).toHaveLength(5);
    expect(cats.find((c) => c.id === "arroces")?.name).toBe("Arroces!");
  });

  it("deleteCategory elimina la categoría", async () => {
    const { products } = await loadStorage();
    await products.deleteCategory("postres");
    expect((await products.getCategories()).map((c) => c.id)).not.toContain("postres");
  });

  it("respeta categorías personalizadas existentes", async () => {
    seedLegacyCategories([{ id: "bebidas", name: "Sólo bebidas", displayOrder: 1 }]);
    const { products } = await loadStorage();
    expect(await products.getCategories()).toEqual([
      { id: "bebidas", name: "Sólo bebidas", displayOrder: 1 },
    ]);
  });
});
