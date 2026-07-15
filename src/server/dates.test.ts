import { describe, expect, it } from "vitest";
import {
  dateInTimeZone,
  isBadenWuerttembergHoliday,
  isWorkday,
  nextWorkday,
  scheduleDates,
} from "./dates.js";

describe("Arbeitstagslogik Baden-Württemberg", () => {
  it("verwendet Europa/Berlin statt UTC", () => {
    expect(dateInTimeZone(new Date("2026-07-14T22:30:00.000Z"))).toBe("2026-07-15");
  });

  it("erkennt feste und bewegliche Feiertage", () => {
    expect(isBadenWuerttembergHoliday("2026-01-06")).toBe(true);
    expect(isBadenWuerttembergHoliday("2026-04-03")).toBe(true); // Karfreitag
    expect(isBadenWuerttembergHoliday("2026-06-04")).toBe(true); // Fronleichnam
    expect(isBadenWuerttembergHoliday("2026-07-15")).toBe(false);
  });

  it("überspringt Wochenenden", () => {
    expect(nextWorkday("2026-07-17")).toBe("2026-07-20");
  });

  it("überspringt das gesamte Osterwochenende einschließlich Feiertagen", () => {
    expect(nextWorkday("2026-04-02")).toBe("2026-04-07");
    expect(isWorkday("2026-04-06")).toBe(false);
  });

  it("liefert heute und den korrekten nächsten Arbeitstag", () => {
    expect(scheduleDates(new Date("2026-07-17T10:00:00.000Z"))).toEqual({
      today: "2026-07-17",
      nextWorkday: "2026-07-20",
    });
  });
});
