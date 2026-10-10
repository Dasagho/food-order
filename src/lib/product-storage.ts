import type { MenuItem, Category, MenuCategory } from "@/types/order";
import { menuItems as defaultMenuItems } from "@/data/menu-items";
import { getBackend } from "./storage";
import type { Backend } from "./storage/types";

const defaultCategories: Category[] = [
  { id: "arroces", name: "Arroces y Paellas", displayOrder: 1 },
  { id: "entrantes", name: "Entrantes", displayOrder: 2 },
  { id: "principales", name: "Platos Principales", displayOrder: 3 },
  { id: "bebidas", name: "Bebidas", displayOrder: 4 },
  { id: "postres", name: "Postres", displayOrder: 5 },
];

// Backend listo y con los valores por defecto sembrados (solo la primera vez)
let ready: Promise<Backend> | null = null;
function backend(): Promise<Backend> {
  if (!ready) {
    ready = (async () => {
      const b = await getBackend();
      await b.seedDefaults(
        defaultMenuItems as unknown as MenuItem[],
        defaultCategories,
      );
      return b;
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}

// Productos
export async function getProducts(): Promise<MenuItem[]> {
  return (await backend()).listProducts();
}

export async function saveProduct(product: MenuItem): Promise<void> {
  await (await backend()).upsertProduct(product);
}

export async function deleteProduct(productId: string): Promise<void> {
  await (await backend()).removeProduct(productId);
}

export async function updateProductOrder(products: MenuItem[]): Promise<void> {
  await (await backend()).replaceProducts(products);
}

// Categorías
export async function getCategories(): Promise<Category[]> {
  return (await backend()).listCategories();
}

export async function saveCategory(category: Category): Promise<void> {
  await (await backend()).upsertCategory(category);
}

export async function deleteCategory(categoryId: MenuCategory): Promise<void> {
  await (await backend()).removeCategory(categoryId);
}
