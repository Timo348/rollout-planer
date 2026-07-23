import type { FastifyBaseLogger } from "fastify";
import type { Appointment } from "../shared/contracts.js";
import { buildAgendaText, buildAppointmentSubject, buildIcs } from "./agenda.js";
import { APP_TIME_ZONE, dateInTimeZone } from "./dates.js";
import type { MailTransport } from "./mailer.js";
import type { StateStore } from "./store.js";

export const AGENDA_SEND_HOUR = 7;

type SchedulerLog = Pick<FastifyBaseLogger, "info" | "error">;

export async function sendDailyAgendas(
  store: StateStore,
  transport: MailTransport,
  organizerEmail: string,
  now: Date = new Date(),
): Promise<number> {
  const today = dateInTimeZone(now);
  const assignments = await store.getDailyAssignments(today);
  const grouped = new Map<
    string,
    { displayName: string; email: string | undefined; appointments: Appointment[] }
  >();
  for (const { appointment, assignee } of assignments) {
    if (assignee.agendaMailsEnabled === false) continue;
    const entry =
      grouped.get(assignee.id) ??
      { displayName: assignee.displayName, email: assignee.email, appointments: [] };
    entry.appointments.push(appointment);
    grouped.set(assignee.id, entry);
  }

  let sent = 0;
  for (const entry of grouped.values()) {
    if (!entry.email) continue;
    // Eine Einladung pro Termin: Kalender-Clients verarbeiten bei
    // METHOD:REQUEST nur den ersten VEVENT pro Nachricht zuverlässig.
    for (const appointment of entry.appointments) {
      await transport({
        to: entry.email,
        subject: buildAppointmentSubject(today, appointment),
        text: buildAgendaText(entry.displayName, today, [appointment]),
        ics: buildIcs(
          [appointment],
          now,
          { name: "Rollout Planer", email: organizerEmail },
          { name: entry.displayName, email: entry.email },
        ),
        icsFileName: `rollout-termin-${today}-${appointment.startTime.replace(":", "")}.ics`,
      });
      sent += 1;
    }
  }
  return sent;
}

export function msUntilNextRun(now: Date, hour: number = AGENDA_SEND_HOUR): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIME_ZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const secondsNow =
    Number(values.hour) * 3600 + Number(values.minute) * 60 + Number(values.second);
  let delaySeconds = hour * 3600 - secondsNow;
  if (delaySeconds <= 0) delaySeconds += 24 * 3600;
  return delaySeconds * 1000 - now.getMilliseconds();
}

export function startDailyAgendaScheduler(
  store: StateStore,
  transport: MailTransport,
  organizerEmail: string,
  log: SchedulerLog,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    try {
      const sent = await sendDailyAgendas(store, transport, organizerEmail);
      log.info({ sent }, "Tägliche Termin-E-Mails versendet.");
    } catch (error) {
      log.error({ err: error }, "Der Versand der täglichen Termin-E-Mails ist fehlgeschlagen.");
    } finally {
      if (!stopped) schedule();
    }
  };

  const schedule = () => {
    timer = setTimeout(() => {
      void tick();
    }, msUntilNextRun(new Date()));
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
