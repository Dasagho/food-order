import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// El dispositivo del usuario puede estar en cualquier zona horaria; las fechas de
// negocio siempre son las de Europe/Madrid.
const ZONES = ["Europe/Madrid", "America/New_York", "Asia/Tokyo", "Pacific/Auckland"];

describe.each(ZONES)("fechas con el dispositivo en %s", (zone) => {
  const originalTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = zone;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTZ;
  });

  it("el pedido se guarda con el instante real (sin desplazar)", async () => {
    vi.setSystemTime(new Date("2025-07-01T23:30:00Z"));
    const { getOrderTimestamp } = await import("@/lib/date-utils");
    expect(getOrderTimestamp().getTime()).toBe(Date.now());
  });

  it("23:30Z de verano cuenta como el día siguiente de Madrid", async () => {
    const { toMadridDateString } = await import("@/lib/date-utils");
    expect(toMadridDateString(new Date("2025-07-01T23:30:00Z"))).toBe("2025-07-02");
    expect(toMadridDateString(new Date("2025-07-01T21:30:00Z"))).toBe("2025-07-01");
  });

  it("'hoy' es el día de Madrid y el día calendario seleccionado coincide", async () => {
    vi.setSystemTime(new Date("2025-07-01T23:30:00Z")); // en Madrid ya es 02/07 01:30
    const { getTodayInMadrid, toLocalDateString } = await import("@/lib/date-utils");
    expect(toLocalDateString(getTodayInMadrid())).toBe("2025-07-02");
  });

  it("un pedido de hoy aparece en la lista de hoy", async () => {
    vi.setSystemTime(new Date("2025-07-01T23:30:00Z"));
    const { getOrderTimestamp, getTodayInMadrid, toLocalDateString, toMadridDateString } =
      await import("@/lib/date-utils");
    const order = getOrderTimestamp();
    expect(toMadridDateString(order)).toBe(toLocalDateString(getTodayInMadrid()));
  });

  it("el resumen muestra el día correcto (2 de julio) sin desfase", async () => {
    vi.useRealTimers();
    const { DailySalesSummary } = await import("@/components/daily-sales-summary");
    const { makeOrder } = await import("./helpers");
    render(<DailySalesSummary orders={[makeOrder()]} selectedDate="2025-07-02" />);
    expect(screen.getByText(/2 de julio de 2025/)).toBeInTheDocument();
  });
});

// Flujo real: el pedido creado desde la pantalla principal queda con la hora real
describe.each(["America/New_York", "Asia/Tokyo"])("Home guarda la hora real con el dispositivo en %s", (zone) => {
  const originalTZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = zone;
  });
  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it("order.date coincide con el instante de confirmar el pedido", async () => {
    const { default: Home } = await import("@/Home");
    render(<MemoryRouter><Home /></MemoryRouter>);
    await screen.findByText("Paella Valenciana");
    await userEvent.click(screen.getAllByRole("button", { name: /Ración Completa/ })[0]);
    await userEvent.click(await screen.findByRole("button", { name: /Ver pedido/ }));
    const before = Date.now();
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
    const { getOrders } = await import("@/lib/order-storage");
    await waitFor(async () => expect(await getOrders()).toHaveLength(1));
    const [order] = await getOrders();
    expect(Math.abs(order.date.getTime() - before)).toBeLessThan(10_000);
  });
});
