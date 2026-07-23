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

export interface AgendaParticipant {
  name: string;
  email: string;
}

function quoteParam(value: string): string {
  return `"${value.replace(/"/g, "")}"`;
}

export function buildIcs(
  appointments: Appointment[],
  timestamp: Date,
  organizer: AgendaParticipant,
  attendee: AgendaParticipant,
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//rollout-planer//tagesagenda//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
  ];
  for (const appointment of appointments) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${appointment.id}@rollout-planer`,
      `DTSTAMP:${compactUtc(timestamp)}`,
      `DTSTART;TZID=Europe/Berlin:${compactLocal(appointment.date, appointment.startTime)}`,
      `DTEND;TZID=Europe/Berlin:${compactLocal(appointment.date, appointment.endTime)}`,
      `SUMMARY:${escapeIcsText(appointment.name)}`,
      `ORGANIZER;CN=${quoteParam(organizer.name)}:mailto:${organizer.email}`,
      `ATTENDEE;CN=${quoteParam(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${attendee.email}`,
      "STATUS:CONFIRMED",
      "SEQUENCE:0",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function buildAppointmentSubject(date: string, appointment: Appointment): string {
  return `Rollout-Termin am ${formatGermanDate(date)}, ${appointment.startTime}–${appointment.endTime} Uhr: ${appointment.name}`;
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
    appointments.length === 1
      ? `dein Termin am ${formatGermanDate(date)}:`
      : `deine Termine am ${formatGermanDate(date)}:`,
    "",
    ...lines,
    "",
    "Die Termine liegen als Kalendereinladung (.ics) im Anhang und können dort direkt angenommen werden.",
    "",
    "— Rollout Planer",
  ].join("\n");
}
