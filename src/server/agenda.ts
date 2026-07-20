import type { Appointment } from "../shared/contracts.js";

export function formatGermanDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function compactLocal(date: string, time: string): string {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function compactUtc(instant: Date): string {
  return instant
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}/, "");
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export function buildIcs(appointments: Appointment[], timestamp: Date): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//rollout-planer//tagesagenda//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const appointment of appointments) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${appointment.id}@rollout-planer`,
      `DTSTAMP:${compactUtc(timestamp)}`,
      `DTSTART;TZID=Europe/Berlin:${compactLocal(appointment.date, appointment.startTime)}`,
      `DTEND;TZID=Europe/Berlin:${compactLocal(appointment.date, appointment.endTime)}`,
      `SUMMARY:${escapeIcsText(appointment.name)}`,
      "STATUS:CONFIRMED",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function buildAgendaSubject(date: string): string {
  return `Deine Rollout-Termine am ${formatGermanDate(date)}`;
}

export function buildAgendaText(
  displayName: string,
  date: string,
  appointments: Appointment[],
): string {
  const lines = appointments.map(
    (appointment) => `- ${appointment.startTime}–${appointment.endTime} Uhr: ${appointment.name}`,
  );
  return [
    `Hallo ${displayName},`,
    "",
    `deine Termine am ${formatGermanDate(date)}:`,
    "",
    ...lines,
    "",
    "Die Termine liegen als Kalenderdatei (.ics) im Anhang.",
    "",
    "— Rollout Planer",
  ].join("\n");
}
