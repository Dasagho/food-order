import type { MenuItem, Category, MenuCategory } from "@/types/order";
import { menuItems as defaultMenuItems } from "@/data/menu-items";

const PRODUCTS_KEY = "menu_products";
const CATEGORIES_KEY = "menu_categories";

// Inicializar con datos por defecto si no existen
function initializeDefaultData() {
  if (typeof window === "undefined") return;

  const existingProducts = localStorage.getItem(PRODUCTS_KEY);
  const existingCategories = localStorage.getItem(CATEGORIES_KEY);

  if (!existingProducts) {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(defaultMenuItems));
  }

  if (!existingCategories) {
    const defaultCategories: Category[] = [
      { id: "arroces", name: "Arroces y Paellas", displayOrder: 1 },
      { id: "entrantes", name: "Entrantes", displayOrder: 2 },
      { id: "principales", name: "Platos Principales", displayOrder: 3 },
      { id: "bebidas", name: "Bebidas", displayOrder: 4 },
      { id: "postres", name: "Postres", displayOrder: 5 },
    ];
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(defaultCategories));
  }
}

// Productos
export function getProducts(): MenuItem[] {
  if (typeof window === "undefined") return [];
  initializeDefaultData();

  const stored = localStorage.getItem(PRODUCTS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveProduct(product: MenuItem): void {
  if (typeof window === "undefined") return;

  const products = getProducts();
  const existingIndex = products.findIndex((p) => p.id === product.id);

  if (existingIndex >= 0) {
    products[existingIndex] = product;
  } else {
    products.push(product);
  }

  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
}

export function deleteProduct(productId: string): void {
  if (typeof window === "undefined") return;

  const products = getProducts();
  const filtered = products.filter((p) => p.id !== productId);
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(filtered));
}

export function updateProductOrder(products: MenuItem[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
}

// Categorías
export function getCategories(): Category[] {
  if (typeof window === "undefined") return [];
  initializeDefaultData();

  const stored = localStorage.getItem(CATEGORIES_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveCategory(category: Category): void {
  if (typeof window === "undefined") return;

  const categories = getCategories();
  const existingIndex = categories.findIndex((c) => c.id === category.id);

  if (existingIndex >= 0) {
    categories[existingIndex] = category;
  } else {
    categories.push(category);
  }

  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

export function deleteCategory(categoryId: MenuCategory): void {
  if (typeof window === "undefined") return;

  const categories = getCategories();
  const filtered = categories.filter((c) => c.id !== categoryId);
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(filtered));
}
