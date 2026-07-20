import { describe, expect, it } from "vitest";
import type { Appointment } from "../shared/contracts.js";
import { buildAgendaSubject, buildAgendaText, buildIcs } from "./agenda.js";

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appt-1",
    date: "2026-07-20",
    startTime: "08:00",
    endTime: "09:00",
    name: "Kunde A, Filiale; Süd",
    assigneeId: "oidc:alice",
    createdBy: "oidc:alice",
    createdAt: "2026-07-19T08:00:00.000Z",
    updatedAt: "2026-07-19T08:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("Tagesagenda", () => {
  it("baut eine iCal-Datei mit einem VEVENT pro Termin", () => {
    const ics = buildIcs(
      [
        appointment(),
        appointment({ id: "appt-2", startTime: "10:00", endTime: "11:00", name: "Zweiter" }),
      ],
      new Date("2026-07-20T05:00:00.000Z"),
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260720T080000");
    expect(ics).toContain("DTEND;TZID=Europe/Berlin:20260720T090000");
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260720T100000");
    expect(ics).toContain("SUMMARY:Kunde A\\, Filiale\\; Süd");
    expect(ics).toContain("UID:appt-1@rollout-planer");
    expect(ics).toContain("DTSTAMP:20260720T050000Z");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("formuliert Betreff und Text auf Deutsch", () => {
    expect(buildAgendaSubject("2026-07-20")).toBe("Deine Rollout-Termine am 20.07.2026");
    const text = buildAgendaText("Alice Beispiel", "2026-07-20", [appointment()]);
    expect(text).toContain("Hallo Alice Beispiel,");
    expect(text).toContain("- 08:00–09:00 Uhr: Kunde A, Filiale; Süd");
    expect(text).toContain(".ics");
  });
});
