import { describe, it, expect } from "vitest";
import { loadStorage, makeOrder, makeItem } from "./helpers";

// Regresión del incidente original: localStorage (~5 MB) se desbordaba.
// Esperado: FALLA en la versión con localStorage, PASA con IndexedDB.
describe("capacidad de almacenamiento", () => {
  it("admite mucho más de 5 MB de pedidos sin perder ninguno", async () => {
    const { orders } = await loadStorage();
    const bigImage = "data:image/png;base64," + "A".repeat(100_000);
    const N = 70; // ~7 MB serializados (límite localStorage ≈ 5 MB)
    for (let i = 1; i <= N; i++) {
      await orders.saveOrder(
        makeOrder({ id: `o${i}`, orderNumber: i, items: [makeItem({ image: bigImage, quantity: 2 })] }),
      );
    }
    const list = await orders.getOrders();
    expect(list).toHaveLength(N);
    expect(await orders.getNextOrderNumber()).toBe(N + 1);
  }, 120_000);
});
