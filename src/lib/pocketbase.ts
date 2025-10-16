import PocketBase from "pocketbase";
import type { ConfirmedOrder } from "@/types/order";

// Inicializar PocketBase - Reemplaza con tu URL de PocketBase
const PB_URL = import.meta.env.VITE_POCKETBASE_URL;
console.log(PB_URL);

let pb: PocketBase | null = null;

export function getPocketBase(): PocketBase {
  if (!pb) {
    pb = new PocketBase(PB_URL);
    pb.autoCancellation(false);
  }
  return pb;
}

// Verificar si hay conexi�n a internet
export function isOnline(): boolean {
  if (typeof window === "undefined") return false;
  return navigator.onLine;
}

// Autenticaci�n OAuth con Google
export async function loginWithOAuth(
  provider: "google" | "github" | "microsoft" = "google",
) {
  const pb = getPocketBase();

  try {
    const authData = await pb.collection("users").authWithOAuth2({ provider });
    console.log("Usuario autenticado:", authData.record.email);
    return authData;
  } catch (error) {
    console.error("Error en autenticación OAuth:", error);
    throw error;
  }
}

// Cerrar sesión
export function logout() {
  const pb = getPocketBase();
  pb.authStore.clear();
}

// Verificar si el usuario est� autenticado
export function isAuthenticated(): boolean {
  const pb = getPocketBase();
  return pb.authStore.isValid;
}

// Obtener usuario actual
export function getCurrentUser() {
  const pb = getPocketBase();
  return pb.authStore.model;
}

// Sincronizar pedido con PocketBase
export async function syncOrderToPocketBase(
  order: ConfirmedOrder,
): Promise<boolean> {
  if (!isOnline() || !isAuthenticated()) {
    console.log("No se puede sincronizar: sin conexi�n o no autenticado");
    return false;
  }

  const pb = getPocketBase();

  try {
    // Crear el pedido en PocketBase
    const record = await pb.collection("orders").create({
      order_id: order.id,
      order_number: order.orderNumber,
      items: JSON.stringify(order.items),
      total: order.total,
      date: order.date.toISOString(),
      status: order.status,
      user: pb.authStore.model?.id,
    });

    console.log("Pedido sincronizado con PocketBase:", record.id);
    return true;
  } catch (error) {
    console.error("Error al sincronizar pedido:", error);
    return false;
  }
}

// Obtener pedidos desde PocketBase
export async function getOrdersFromPocketBase(): Promise<ConfirmedOrder[]> {
  if (!isOnline() || !isAuthenticated()) {
    return [];
  }

  const pb = getPocketBase();

  try {
    const records = await pb.collection("orders").getFullList({
      sort: "-created",
      filter: `user = "${pb.authStore.model?.id}"`,
    });

    return records.map((record: any) => ({
      id: record.order_id,
      orderNumber: record.order_number,
      items: JSON.parse(record.items),
      total: record.total,
      date: new Date(record.date),
      status: record.status,
    }));
  } catch (error) {
    console.error("Error al obtener pedidos de PocketBase:", error);
    return [];
  }
}

// Sincronizar todos los pedidos locales con PocketBase
export async function syncAllOrdersToPocketBase(
  localOrders: ConfirmedOrder[],
): Promise<void> {
  if (!isOnline() || !isAuthenticated()) {
    console.log("No se puede sincronizar: sin conexi�n o no autenticado");
    return;
  }

  console.log("Iniciando sincronizaci�n de", localOrders.length, "pedidos...");

  for (const order of localOrders) {
    await syncOrderToPocketBase(order);
  }

  console.log("Sincronizaci�n completada");
}

// Listener para cambios en el estado de autenticaci�n
export function onAuthChange(callback: (isAuth: boolean) => void) {
  const pb = getPocketBase();
  pb.authStore.onChange(() => {
    callback(pb.authStore.isValid);
  });
}
