import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppUser } from "../shared/contracts.js";
import type { AgendaMail } from "./mailer.js";
import { msUntilNextRun, sendDailyAgendas } from "./scheduler.js";
import { StateStore } from "./store.js";
import { createTestDatabase, resetTestDatabase } from "./testdb.js";

const stores: StateStore[] = [];
let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = await createTestDatabase("rollout_test_scheduler");
});

beforeEach(async () => {
  await resetTestDatabase(databaseUrl);
});

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

function user(id: string, email?: string): AppUser {
  return {
    id,
    username: id.split(":")[1]!,
    displayName: `${id.split(":")[1]} Beispiel`,
    ...(email ? { email } : {}),
    source: "oidc",
    lastSeenAt: "2026-07-15T08:00:00.000Z",
  };
}

function makeStore(now: () => Date): StateStore {
  const store = new StateStore(databaseUrl, now, false);
  stores.push(store);
  return store;
}

describe("Tägliche Termin-E-Mails", () => {
  it("versendet pro Benutzer eine Mail mit iCal-Anhang an die in Authentik hinterlegte Adresse", async () => {
    // 05:00 UTC = 07:00 Europe/Berlin (MESZ)
    const now = () => new Date("2026-07-15T05:00:00.000Z");
    const store = makeStore(now);
    await store.initialize();
    await store.upsertUser(user("oidc:alice", "alice@example.com"));
    await store.upsertUser(user("oidc:bob"));
    const [first] = await store.createBatch(
      "2026-07-15",
      [{ startTime: "08:00", endTime: "09:00", names: ["Kunde A"] }],
      "oidc:alice",
    );
    const [second] = await store.createBatch(
      "2026-07-15",
      [{ startTime: "10:00", endTime: "11:00", names: ["Kunde B"] }],
      "oidc:alice",
    );
    await store.updateAppointment(first!.id, 1, { assigneeId: "oidc:alice" });
    await store.updateAppointment(second!.id, 1, { assigneeId: "oidc:bob" });

    const mails: AgendaMail[] = [];
    const sent = await sendDailyAgendas(
      store,
      async (mail) => {
        mails.push(mail);
      },
      "rollout-planer@example.com",
      now(),
    );

    expect(sent).toBe(1);
    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    expect(mail.to).toBe("alice@example.com");
    expect(mail.subject).toBe("Deine Rollout-Termine am 15.07.2026");
    expect(mail.text).toContain("Kunde A");
    expect(mail.text).not.toContain("Kunde B");
    expect(mail.ics).toContain("METHOD:REQUEST");
    expect(mail.ics).toContain("SUMMARY:Kunde A");
    expect(mail.ics).not.toContain("SUMMARY:Kunde B");
    expect(mail.ics).toContain("ORGANIZER;CN=\"Rollout Planer\":mailto:rollout-planer@example.com");
    expect(mail.ics).toContain("ATTENDEE;CN=\"alice Beispiel\";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:alice@example.com");
    expect(mail.icsFileName).toBe("rollout-termine-2026-07-15.ics");
  });

  it("überspringt Tage ohne zugewiesene Termine", async () => {
    const now = () => new Date("2026-07-15T05:00:00.000Z");
    const store = makeStore(now);
    await store.initialize();
    await store.upsertUser(user("oidc:alice", "alice@example.com"));

    const mails: AgendaMail[] = [];
    const sent = await sendDailyAgendas(store, async (mail) => {
      mails.push(mail);
    }, "rollout-planer@example.com", now());

    expect(sent).toBe(0);
    expect(mails).toHaveLength(0);
  });

  it("überspringt Benutzer mit deaktivierter Termin-E-Mail", async () => {
    const now = () => new Date("2026-07-15T05:00:00.000Z");
    const store = makeStore(now);
    await store.initialize();
    await store.upsertUser(user("oidc:alice", "alice@example.com"));
    await store.setAgendaMailsEnabled("oidc:alice", false);
    const [appointment] = await store.createBatch(
      "2026-07-15",
      [{ startTime: "08:00", endTime: "09:00", names: ["Kunde A"] }],
      "oidc:alice",
    );
    await store.updateAppointment(appointment!.id, 1, { assigneeId: "oidc:alice" });

    const mails: AgendaMail[] = [];
    const sent = await sendDailyAgendas(store, async (mail) => {
      mails.push(mail);
    }, "rollout-planer@example.com", now());

    expect(sent).toBe(0);
    expect(mails).toHaveLength(0);
  });

  it("berechnet die Wartezeit bis zum nächsten 7-Uhr-Lauf in Berliner Zeit", () => {
    // 06:59 Berlin (MESZ, UTC+2)
    expect(msUntilNextRun(new Date("2026-07-15T04:59:00.000Z"))).toBe(60_000);
    // genau 07:00 Berlin → nächster Tag
    expect(msUntilNextRun(new Date("2026-07-15T05:00:00.000Z"))).toBe(24 * 3600 * 1000);
    // 23:30 Berlin → 7,5 Stunden
    expect(msUntilNextRun(new Date("2026-07-15T21:30:00.000Z"))).toBe(7.5 * 3600 * 1000);
    // Winterzeit (MEZ, UTC+1): 06:30 Berlin → 30 Minuten
    expect(msUntilNextRun(new Date("2026-01-15T05:30:00.000Z"))).toBe(30 * 60 * 1000);
  });
});
