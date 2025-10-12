export interface OrderItem {
  id: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  category: "arroces" | "entrantes" | "principales" | "postres";
  portionType: "racion" | "unidades";
  halfPortionPrice?: number;
  isHalfPortion?: boolean;
}

export interface ConfirmedOrder {
  id: string;
  orderNumber: number;
  items: OrderItem[];
  total: number;
  date: Date;
  status: "completado" | "en_proceso" | "cancelado";
}

export type MenuCategory = "arroces" | "entrantes" | "principales" | "postres";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  image: string;
  category: MenuCategory;
  portionType: "racion" | "unidades";
  halfPortionPrice?: number;
}

export interface Category {
  id: MenuCategory;
  name: string;
  displayOrder: number;
}
