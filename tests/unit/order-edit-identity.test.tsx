import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeItem, makeOrder } from "./helpers";

const full = () => makeItem({ id: "1", name: "Paella", price: 4.5, quantity: 2, isHalfPortion: false });
const half = () => makeItem({ id: "1", name: "Paella", price: 3, quantity: 1, isHalfPortion: true });

describe("OrderConfirmationModal: ración completa y media del mismo plato", () => {
  async function setup() {
    const { OrderConfirmationModal } = await import("@/components/order-confirmation-modal");
    const onConfirm = vi.fn();
    render(<OrderConfirmationModal isOpen items={[full(), half()]} onConfirm={onConfirm} onClose={() => {}} />);
    return { onConfirm };
  }

  it("cambiar el precio de la ración completa no cambia el de la media", async () => {
    const { onConfirm } = await setup();
    const [fullPrice] = screen.getAllByRole("spinbutton");
    await userEvent.clear(fullPrice);
    await userEvent.type(fullPrice, "5");
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
    const items = onConfirm.mock.calls[0][1];
    expect(items.find((i: any) => !i.isHalfPortion).price).toBe(5);
    expect(items.find((i: any) => i.isHalfPortion).price).toBe(3);
  });

  it("cambiar el precio de la media no cambia el de la completa", async () => {
    const { onConfirm } = await setup();
    const prices = screen.getAllByRole("spinbutton");
    await userEvent.clear(prices[1]);
    await userEvent.type(prices[1], "2");
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
    const items = onConfirm.mock.calls[0][1];
    expect(items.find((i: any) => !i.isHalfPortion).price).toBe(4.5);
    expect(items.find((i: any) => i.isHalfPortion).price).toBe(2);
  });

  it("las filas se distinguen visualmente (Media)", async () => {
    await setup();
    expect(screen.getAllByText(/\(Media\)/)).toHaveLength(1);
  });

  it("no hay claves duplicadas de React", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await setup();
    expect(err.mock.calls.flat().join(" ")).not.toMatch(/same key|unique "key"/);
  });
});

describe("OrderDetailModal: ración completa y media del mismo plato", () => {
  async function setup() {
    vi.doMock("@/lib/order-storage", () => ({
      updateOrder: vi.fn().mockResolvedValue(undefined),
      updateOrderStatus: vi.fn().mockResolvedValue(undefined),
    }));
    const storage = await import("@/lib/order-storage");
    const { OrderDetailModal } = await import("@/components/order-detail-modal");
    const order = makeOrder({ id: "o", items: [full(), half()] });
    const onUpdate = vi.fn();
    render(<OrderDetailModal order={order} onClose={() => {}} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole("button", { name: /Editar Pedido/ }));
    const saved = async () => {
      await userEvent.click(screen.getByRole("button", { name: /Guardar Cambios/ }));
      return (storage.updateOrder as any).mock.calls[0][1];
    };
    return { saved };
  }

  it("añadir una unidad a la completa no toca la media", async () => {
    const { saved } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Añadir una unidad de Paella" }));
    const items = await saved();
    expect(items.find((i: any) => !i.isHalfPortion).quantity).toBe(3);
    expect(items.find((i: any) => i.isHalfPortion).quantity).toBe(1);
  });

  it("quitar la media deja intacta la completa", async () => {
    const { saved } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Quitar Paella (media) del pedido" }));
    const items = await saved();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ isHalfPortion: false, quantity: 2 });
  });

  it("restar a la media hasta 0 la elimina sin afectar a la completa", async () => {
    const { saved } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Quitar una unidad de Paella (media)" }));
    const items = await saved();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ isHalfPortion: false, quantity: 2 });
  });

  it("no hay claves duplicadas de React", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await setup();
    expect(err.mock.calls.flat().join(" ")).not.toMatch(/same key|unique "key"/);
  });
});
