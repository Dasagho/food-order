import { describe, it, expect } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { boot } from "./helpers";
import { renderApp, waitForMenu } from "./render";

const tile = (name: string) => screen.getByRole("heading", { name }).closest("li") as HTMLElement;
const dialog = () => screen.getByRole("dialog");
const ticket = () => document.getElementById("ticket") as HTMLElement;

async function setup(path = "/") {
  const app = await boot();
  await renderApp(path);
  await waitForMenu();
  return app;
}

/** Crea un pedido en proceso en el servidor (fake) con una Paella. */
async function seedInProcess(app: Awaited<ReturnType<typeof boot>>, over: Record<string, unknown> = {}) {
  const { api } = await import("@/lib/api");
  const body = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "en_proceso" as const,
    paymentMethod: "efectivo" as const,
    items: [{ productId: "1", name: "Paella Valenciana", unitPrice: 4.5, listPrice: 4.5, quantity: 1, half: false }],
    ...over,
  };
  await api.orders.create(body);
  return body.id as string;
}

describe("Caja: la rejilla y el ticket", () => {
  it("tocar un plato lo suma al ticket y el total se anuncia con aria-live", async () => {
    await setup();
    const user = userEvent.setup();
    await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Completa de Paella Valenciana/ }));
    await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Completa de Paella Valenciana/ }));
    await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Media de Paella Valenciana/ }));
    const t = within(ticket());
    expect(t.getByText("2")).toBeInTheDocument();
    expect(t.getByText("(media)")).toBeInTheDocument();
    const total = ticket().querySelector(".total-row .big")!;
    expect(total).toHaveAttribute("aria-live", "polite");
    expect(total).toHaveTextContent(/12,00/); // 2×4,50 + 3,00
    // «Deshacer» quita lo último que se tocó
    await user.click(t.getByRole("button", { name: "Deshacer" }));
    expect(total).toHaveTextContent(/9,00/);
  });

  it("sin precio de media ración no se ofrece «Media»; las unidades solo «Añadir»", async () => {
    const app = await boot();
    app.api.products.find((p) => p.id === "2")!.halfPortionPrice = null;
    await renderApp();
    await waitForMenu();
    expect(within(tile("Paella Valenciana")).getByRole("button", { name: /Media/ })).toBeInTheDocument();
    // ración sin media: un único botón «Ración»
    expect(within(tile("Arroz de marisco")).queryByRole("button", { name: /Media/ })).toBeNull();
    expect(within(tile("Arroz de marisco")).getByRole("button", { name: /Cobrar Ración/ })).toBeInTheDocument();
    expect(within(tile("Croqueta de jamón")).getByRole("button", { name: /Cobrar Añadir/ })).toBeInTheDocument();
    expect(within(tile("Croqueta de jamón")).queryByRole("button", { name: /Media/ })).toBeNull();
  });

  it("un plato agotado se ve pero no se puede añadir", async () => {
    const app = await boot();
    app.api.products.find((p) => p.id === "4")!.available = false;
    await renderApp();
    await waitForMenu();
    const li = tile("Lata de refresco");
    expect(li).toHaveTextContent("Agotado");
    expect(within(li).queryByRole("button")).toBeNull();
  });

  it("el filtro por sección usa aria-pressed", async () => {
    await setup();
    const user = userEvent.setup();
    const group = screen.getByRole("group", { name: "Sección del menú" });
    expect(within(group).getByRole("button", { name: "Todo" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "Bebidas" }));
    expect(within(group).getByRole("button", { name: "Bebidas" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "Paella Valenciana" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Lata de refresco" })).toBeInTheDocument();
  });

  it("precio por línea: se guarda unitPrice (cobrado) y listPrice (de carta) y se marca «(cambiado)»", async () => {
    const app = await setup();
    const user = userEvent.setup();
    await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Completa/ }));
    await user.click(within(ticket()).getByRole("button", { name: /Cambiar el precio de Paella Valenciana/ }));
    const input = within(dialog()).getByLabelText("Precio de cada uno (€)");
    await user.clear(input);
    await user.type(input, "4");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    expect(ticket()).toHaveTextContent("(cambiado)");
    await user.click(within(ticket()).getByRole("button", { name: /^Cobrar/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Confirmar" }));
    await screen.findByText(/Venta 1 guardada/);
    expect(app.api.orders[0].items[0]).toMatchObject({ unitPrice: 4, listPrice: 4.5 });
    // importe inválido: más de 2 decimales
    await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Completa/ }));
    await user.click(within(ticket()).getByRole("button", { name: /Cambiar el precio/ }));
    await user.clear(within(dialog()).getByLabelText("Precio de cada uno (€)"));
    await user.type(within(dialog()).getByLabelText("Precio de cada uno (€)"), "4.555");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(/máximo 2 decimales/);
  });
});

describe("Caja: cobro", () => {
  async function toPay(times = 3) {
    const app = await setup();
    const user = userEvent.setup();
    for (let i = 0; i < times; i++) await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Completa/ }));
    await user.click(within(ticket()).getByRole("button", { name: /^Cobrar/ }));
    return { app, user };
  }

  it("calculadora de efectivo: 20 € sobre 13,50 € → «Devolver 6,50 €»; 10 € → «Faltan 3,50 €» y no se puede confirmar", async () => {
    const { user } = await toPay(3); // 13,50 €
    const d = within(dialog());
    await user.click(d.getByRole("button", { name: /^20/ }));
    expect(dialog().querySelector(".change-big")).toHaveTextContent(/Devolver\s*6,50/);
    // 10 € es menos del total: el botón rápido está deshabilitado, «Otra cantidad» muestra «Faltan»
    expect(d.getByRole("button", { name: /^10/ })).toBeDisabled();
    await user.type(d.getByLabelText("Otra cantidad (€)"), "10");
    expect(d.getByRole("alert")).toHaveTextContent(/Faltan\s*3,50/);
    expect(d.getByRole("button", { name: "Confirmar" })).toBeDisabled();
  });

  it("confirmar crea UN pedido completado con la entrega; «Dejar en proceso» está desactivado por defecto", async () => {
    const { app, user } = await toPay(1);
    const sw = within(dialog()).getByRole("switch", { name: "Dejar en proceso" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await user.click(within(dialog()).getByRole("button", { name: "5 €" }));
    await user.click(within(dialog()).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(app.api.orders).toHaveLength(1));
    expect(app.api.orders[0]).toMatchObject({ status: "completado", paymentMethod: "efectivo", amountReceived: 5 });
    // aviso persistente con el cambio
    expect(await screen.findByText(/Venta 1 guardada/)).toBeInTheDocument();
    expect(screen.getByText(/Devolver/)).toHaveTextContent(/0,50/);
    expect(ticket()).toHaveTextContent("Ticket vacío");
  });

  it("«Dejar en proceso» deja el pedido en en_proceso y no pide efectivo", async () => {
    const { app, user } = await toPay(1);
    await user.click(within(dialog()).getByRole("switch", { name: "Dejar en proceso" }));
    expect(within(dialog()).queryByText("¿Con cuánto paga?")).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "Guardar en proceso" }));
    await waitFor(() => expect(app.api.orders).toHaveLength(1));
    expect(app.api.orders[0].status).toBe("en_proceso");
    expect(await screen.findByText(/^Pedido \S+ en proceso/)).toBeInTheDocument();
  });

  it("anti doble toque: un doble clic en Confirmar crea un solo pedido", async () => {
    const { app, user } = await toPay(1);
    await user.dblClick(within(dialog()).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(app.api.orders).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(app.api.orders).toHaveLength(1);
    expect(app.api.log.filter((l) => l.method === "POST" && l.path === "/v1/orders")).toHaveLength(1);
  });
});

describe("Caja: pedidos en proceso", () => {
  it("solo se listan los en_proceso; Abrir los carga en el ticket y se editan cantidad, precio y forma de pago", async () => {
    const app = await boot();
    const id = await seedInProcess(app);
    await seedInProcess(app, { status: "completado" });
    await renderApp();
    await waitForMenu();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /En proceso \(1\)/ }));
    expect(within(dialog()).getAllByRole("listitem")).toHaveLength(1);
    await user.click(within(dialog()).getByRole("button", { name: "Abrir" }));
    // modo edición
    expect(within(ticket()).getByRole("heading", { level: 2 })).toHaveTextContent(/Pedido nº/);
    await user.click(within(ticket()).getByRole("button", { name: /Añadir uno más: Paella Valenciana/ }));
    await user.click(within(ticket()).getByRole("button", { name: /Cambiar el precio de Paella/ }));
    const input = within(dialog()).getByLabelText("Precio de cada uno (€)");
    await user.clear(input);
    await user.type(input, "4");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    await user.click(within(ticket()).getByRole("button", { name: "Tarjeta" }));
    await user.click(within(ticket()).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === id)!.revision).toBe(2));
    const o = app.api.orders.find((o) => o.id === id)!;
    expect(o).toMatchObject({ paymentMethod: "tarjeta", status: "en_proceso" });
    expect(o.items[0]).toMatchObject({ quantity: 2, unitPrice: 4, listPrice: 4.5 });
  });

  it("Anular pide confirmación y pasa a cancelado; Cobrar pasa a completado", async () => {
    const app = await boot();
    // createdAt distintos: la lista va por antigüedad y «a» es la primera
    const a = await seedInProcess(app, { createdAt: new Date(Date.now() - 60_000).toISOString() });
    const b = await seedInProcess(app);
    await renderApp();
    await waitForMenu();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /En proceso \(2\)/ }));
    await user.click(within(dialog()).getAllByRole("button", { name: "Abrir" })[0]);
    await user.click(within(ticket()).getByRole("button", { name: "Anular pedido" }));
    await user.click(within(dialog()).getByRole("button", { name: "Sí, anular" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === a)!.status).toBe("cancelado"));

    await user.click(await screen.findByRole("button", { name: /En proceso \(1\)/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Abrir" }));
    await user.click(within(ticket()).getByRole("button", { name: /^Cobrar/ }));
    expect(within(dialog()).getByRole("heading")).toHaveTextContent(/Cobrar pedido nº/);
    expect(within(dialog()).queryByRole("switch")).toBeNull(); // ya no se puede dejar en proceso otra vez
    await user.click(within(dialog()).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === b)!.status).toBe("completado"));
  });

  it("AÑADIR un producto a un pedido en proceso desde el detalle (selector con búsqueda, entera/media, sin agotados)", async () => {
    const app = await boot();
    app.api.products.find((p) => p.id === "4")!.available = false;
    const id = await seedInProcess(app);
    await renderApp();
    await waitForMenu();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /En proceso \(1\)/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Abrir" }));
    await user.click(within(ticket()).getByRole("button", { name: "Añadir un plato" }));
    const d = within(dialog());
    await user.type(d.getByLabelText("Buscar plato"), "arroz");
    expect(d.queryByText("Paella Valenciana")).toBeNull();
    await user.click(d.getByRole("button", { name: /Añadir Media de Arroz de marisco/ }));
    await user.click(d.getByRole("button", { name: /Añadir Completa de Arroz de marisco/ }));
    // el agotado se ve pero no tiene botones
    await user.clear(d.getByLabelText("Buscar plato"));
    await user.type(d.getByLabelText("Buscar plato"), "lata");
    expect(d.getByText("Agotado")).toBeInTheDocument();
    expect(d.queryByRole("button", { name: /Añadir .* Lata/ })).toBeNull();
    await user.click(d.getByRole("button", { name: "Listo" }));
    expect(within(ticket()).getAllByText("Arroz de marisco", { selector: "b" })).toHaveLength(2);
    await user.click(within(ticket()).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === id)!.revision).toBe(2));
    const o = app.api.orders.find((o) => o.id === id)!;
    // lista completa de líneas identificadas por (productId, half); total recalculado por el servidor
    expect(o.items.map((i) => [i.productId, i.half, i.quantity])).toEqual([
      ["1", false, 1],
      ["2", true, 1],
      ["2", false, 1],
    ]);
    // el total lo calcula el servidor: Σ unitPrice × quantity
    expect(o.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)).toBe(4.5 + 3 + 4.5);
    const patch = app.api.log.filter((l) => l.method === "PATCH").at(-1)!;
    expect(patch.headers["if-match"]).toBe('"1"');
  });

  it("añadir un plato que ya está en el pedido suma la cantidad (misma línea producto+media)", async () => {
    const app = await boot();
    const id = await seedInProcess(app);
    await renderApp();
    await waitForMenu();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /En proceso \(1\)/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Abrir" }));
    await user.click(within(ticket()).getByRole("button", { name: "Añadir un plato" }));
    await user.click(within(dialog()).getByRole("button", { name: /Añadir Completa de Paella/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Listo" }));
    await user.click(within(ticket()).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === id)!.revision).toBe(2));
    expect(app.api.orders.find((o) => o.id === id)!.items).toHaveLength(1);
    expect(app.api.orders.find((o) => o.id === id)!.items[0].quantity).toBe(2);
  });
});

describe("Caja: pedidos pendientes de sincronizar", () => {
  async function pendingSale() {
    const app = await setup();
    app.ctl.down = true; // sin red: el pedido queda en la cola de salida
    const user = userEvent.setup();
    await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Completa/ }));
    await user.click(within(ticket()).getByRole("button", { name: /^Cobrar/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Confirmar" }));
    return { app, user };
  }

  it("sin conexión el pedido sale como P-1 «Pendiente» y el indicador de la cabecera cuenta los pendientes", async () => {
    const { app } = await pendingSale();
    expect(await screen.findByText(/Venta P-1 guardada/)).toBeInTheDocument();
    expect(screen.getByText(/Pendiente de enviar/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /1 sin enviar/ })).toBeInTheDocument();
    expect(app.api.orders).toHaveLength(0);
  });

  it("DESCARTAR un pendiente (con confirmación) borra su entrada create de la cola y no llega nunca al servidor", async () => {
    const { app, user } = await pendingSale();
    const { listPending } = await import("@/lib/sync/outbox");
    expect(await listPending()).toHaveLength(1);
    await user.click(await screen.findByRole("button", { name: /1 sin enviar/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Descartar" }));
    // confirmación (segundo diálogo): primero «No, volver» no hace nada
    const confirm = screen.getAllByRole("dialog").at(-1)!;
    await user.click(within(confirm).getByRole("button", { name: "No, volver" }));
    expect(await listPending()).toHaveLength(1);
    await user.click(within(dialog()).getByRole("button", { name: "Descartar" }));
    await user.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "Sí, descartar" }));
    await waitFor(async () => expect(await listPending()).toHaveLength(0));
    // vuelve la red: no se envía nada
    app.ctl.down = false;
    const { flush } = await import("@/lib/sync/outbox");
    await flush();
    expect(app.api.orders).toHaveLength(0);
    expect(app.api.log.filter((l) => l.method === "POST" && l.path === "/v1/orders")).toHaveLength(0);
  });

  it("un pedido ya sincronizado NO ofrece «Descartar»", async () => {
    const app = await boot();
    await seedInProcess(app);
    await renderApp();
    await waitForMenu();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /En proceso \(1\)/ }));
    expect(within(dialog()).getByRole("button", { name: "Abrir" })).toBeInTheDocument();
    expect(within(dialog()).queryByRole("button", { name: "Descartar" })).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "Abrir" }));
    expect(within(ticket()).queryByRole("button", { name: "Descartar este pedido" })).toBeNull();
  });

  it("un pedido pendiente EN PROCESO se descarta también desde su detalle en la Caja", async () => {
    const app = await setup();
    app.ctl.down = true;
    const user = userEvent.setup();
    await user.click(within(tile("Paella Valenciana")).getByRole("button", { name: /Cobrar Completa/ }));
    await user.click(within(ticket()).getByRole("button", { name: /^Cobrar/ }));
    await user.click(within(dialog()).getByRole("switch", { name: "Dejar en proceso" }));
    await user.click(within(dialog()).getByRole("button", { name: "Guardar en proceso" }));
    await screen.findByText(/Pedido P-1 en proceso/);
    await user.click(await screen.findByRole("button", { name: /En proceso \(1\)/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Abrir" }));
    await user.click(within(ticket()).getByRole("button", { name: "Descartar este pedido" }));
    await user.click(within(screen.getAllByRole("dialog").at(-1)!).getByRole("button", { name: "Sí, descartar" }));
    const { listPending } = await import("@/lib/sync/outbox");
    await waitFor(async () => expect(await listPending()).toHaveLength(0));
    await waitFor(() => expect(ticket()).toHaveTextContent("Ticket vacío"));
    fireEvent.click(document.body);
  });
});
