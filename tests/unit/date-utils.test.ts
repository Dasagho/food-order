import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toMadridDateString,
  isSameMadridDay,
  getTodayInMadrid,
  formatMadridDate,
} from "@/lib/date-utils";

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
  it("isSameMadridDay compara por día de Madrid", () => {
    expect(
      isSameMadridDay(new Date("2025-07-01T21:00:00Z"), new Date("2025-07-01T23:00:00Z")),
    ).toBe(false);
    expect(
      isSameMadridDay(new Date("2025-07-01T10:00:00Z"), new Date("2025-07-01T15:00:00Z")),
    ).toBe(true);
  });
  it("getTodayInMadrid devuelve medianoche", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-05-05T15:45:12Z"));
    const d = getTodayInMadrid();
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
  });
  it("formatMadridDate formatea en es-ES", () => {
    expect(
      formatMadridDate(new Date("2025-03-10T12:00:00Z"), { day: "2-digit", month: "2-digit", year: "numeric" }),
    ).toBe("10/03/2025");
  });
});
