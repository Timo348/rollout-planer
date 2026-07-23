import { describe, expect, it } from "vitest";
import type { Appointment } from "../shared/contracts.js";
import { buildAgendaText, buildAppointmentSubject, buildIcs } from "./agenda.js";

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
  it("baut eine iCal-Einladung mit einem VEVENT pro Termin", () => {
    const ics = buildIcs(
      [
        appointment(),
        appointment({ id: "appt-2", startTime: "10:00", endTime: "11:00", name: "Zweiter" }),
      ],
      new Date("2026-07-20T05:00:00.000Z"),
      { name: "Rollout Planer", email: "rollout-planer@example.com" },
      { name: "Alice Beispiel", email: "alice@example.com" },
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260720T080000");
    expect(ics).toContain("DTEND;TZID=Europe/Berlin:20260720T090000");
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260720T100000");
    expect(ics).toContain("SUMMARY:Kunde A\\, Filiale\\; Süd");
    expect(ics).toContain("UID:appt-1@rollout-planer");
    expect(ics).toContain("DTSTAMP:20260720T050000Z");
    expect(ics.match(/ORGANIZER;CN="Rollout Planer":mailto:rollout-planer@example\.com/g)).toHaveLength(2);
    expect(
      ics.match(
        /ATTENDEE;CN="Alice Beispiel";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:alice@example\.com/g,
      ),
    ).toHaveLength(2);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("formuliert Betreff und Text auf Deutsch", () => {
    expect(buildAppointmentSubject("2026-07-20", appointment())).toBe(
      "Rollout-Termin am 20.07.2026, 08:00–09:00 Uhr: Kunde A, Filiale; Süd",
    );
    const text = buildAgendaText("Alice Beispiel", "2026-07-20", [appointment()]);
    expect(text).toContain("Hallo Alice Beispiel,");
    expect(text).toContain("dein Termin am 20.07.2026:");
    expect(text).toContain("- 08:00–09:00 Uhr: Kunde A, Filiale; Süd");
    expect(text).toContain(".ics");
  });
});
