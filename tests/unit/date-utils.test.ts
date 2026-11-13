import { describe, it, expect, vi, afterEach } from "vitest";
import { toMadridDateString, todayMadrid } from "@/lib/date-utils";

afterEach(() => vi.useRealTimers());

describe("date-utils (Europe/Madrid)", () => {
  it("23:30 UTC de verano ya es el día siguiente en Madrid", () => {
    expect(toMadridDateString(new Date("2025-07-01T23:30:00Z"))).toBe("2025-07-02");
  });
  it("23:30 UTC de invierno ya es el día siguiente en Madrid", () => {
    expect(toMadridDateString(new Date("2025-01-15T23:30:00Z"))).toBe("2025-01-16");
  });
  it("mediodía UTC es el mismo día", () => {
    expect(toMadridDateString(new Date("2025-03-10T12:00:00Z"))).toBe("2025-03-10");
  });
  it("todayMadrid devuelve el día de calendario de Madrid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-05-05T22:30:00Z")); // ya es 6 de mayo en Madrid
    expect(todayMadrid()).toBe("2025-05-06");
  });
});

describe("madridToUtc / hhmmMadrid (corregir fecha y hora)", () => {
  it("convierte hora de Madrid a UTC con el cambio de hora de verano e invierno", async () => {
    const { madridToUtc, hhmmMadrid, shiftDay } = await import("@/lib/date-utils");
    expect(madridToUtc("2025-07-01", "13:05")).toBe("2025-07-01T11:05:00.000Z");
    expect(madridToUtc("2025-01-15", "13:05")).toBe("2025-01-15T12:05:00.000Z");
    expect(hhmmMadrid(new Date("2025-07-01T23:30:00Z"))).toBe("01:30");
    expect(shiftDay("2025-03-01", -1)).toBe("2025-02-28");
    expect(shiftDay("2024-12-31", 1)).toBe("2025-01-01");
  });
});
