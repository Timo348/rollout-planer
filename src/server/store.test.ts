import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppUser } from "../shared/contracts.js";
import { ConflictError, StateStore } from "./store.js";

const directories: string[] = [];

async function temporaryFile(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rollout-store-"));
  directories.push(directory);
  return path.join(directory, "state.json");
}

function user(id = "oidc:alice"): AppUser {
  return {
    id,
    username: "alice",
    displayName: "Alice Beispiel",
    source: id.startsWith("dev:") ? "dev" : "oidc",
    lastSeenAt: "2026-07-15T08:00:00.000Z",
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("StateStore", () => {
  it("persistiert aktuelle Termine ohne Datenbank und lädt sie nach Neustart", async () => {
    const file = await temporaryFile();
    const now = () => new Date("2026-07-15T08:00:00.000Z");
    const first = new StateStore(file, now, false);
    await first.initialize();
    await first.upsertUser(user());
    await first.createBatch("2026-07-15", [{ startTime: "08:00", endTime: "09:00", names: ["Kunde A", "Kunde B"] }], "oidc:alice");

    const second = new StateStore(file, now, false);
    await second.initialize();
    const snapshot = await second.getBootstrap("oidc:alice");
    expect(snapshot.appointments.map((entry) => entry.name)).toEqual(["Kunde A", "Kunde B"]);
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(3);
  });

  it("migriert die bisherige JSON-Struktur ohne aktive Termine vorzeitig zu zählen", async () => {
    const file = await temporaryFile();
    await writeFile(file, JSON.stringify({
      schemaVersion: 1,
      users: [user()],
      appointments: [{
        id: "legacy-appointment",
        date: "2026-07-15",
        startTime: "08:00",
        endTime: "09:00",
        name: "Bestandstermin",
        assigneeId: "oidc:alice",
        createdBy: "oidc:alice",
        createdAt: "2026-07-15T08:00:00.000Z",
        updatedAt: "2026-07-15T08:00:00.000Z",
        version: 1,
      }],
    }), "utf8");

    const store = new StateStore(file, () => new Date("2026-07-15T08:00:00.000Z"), false);
    await store.initialize();
    const snapshot = await store.getBootstrap("oidc:alice");
    expect(snapshot.employeeOfMonth.completedCount).toBe(0);
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      schemaVersion: number;
      monthlyCompletions: Record<string, Record<string, number>>;
    };
    expect(raw.schemaVersion).toBe(3);
    expect(raw.monthlyCompletions).toEqual({});
  });

  it("behält bei einer Zwischenmigration abgeschlossene Monate und verwirft den laufenden", async () => {
    const file = await temporaryFile();
    await writeFile(file, JSON.stringify({
      schemaVersion: 2,
      users: [user()],
      appointments: [{
        id: "already-counted",
        date: "2026-06-30",
        startTime: "08:00",
        endTime: "09:00",
        name: "Bereits im Monatswert",
        assigneeId: "oidc:alice",
        createdBy: "oidc:alice",
        createdAt: "2026-06-30T08:00:00.000Z",
        updatedAt: "2026-06-30T08:00:00.000Z",
        version: 1,
      }],
      monthlyAssignments: {
        "2026-06": { "oidc:alice": 4 },
        "2026-07": { "oidc:alice": 9 },
      },
    }), "utf8");

    const store = new StateStore(file, () => new Date("2026-07-15T08:00:00.000Z"), false);
    await store.initialize();
    const snapshot = await store.getBootstrap("oidc:alice");
    expect(snapshot.employeeOfMonth.month).toBe("2026-06");
    expect(snapshot.employeeOfMonth.completedCount).toBe(4);
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      schemaVersion: number;
      monthlyCompletions: Record<string, Record<string, number>>;
    };
    expect(raw.schemaVersion).toBe(3);
    expect(raw.monthlyCompletions).toEqual({ "2026-06": { "oidc:alice": 4 } });
    expect((await store.getBootstrap("oidc:alice")).appointments).toHaveLength(0);
  });

  it("erkennt konkurrierende Änderungen über die Versionsnummer", async () => {
    const file = await temporaryFile();
    const store = new StateStore(file, () => new Date("2026-07-15T08:00:00.000Z"), false);
    await store.initialize();
    await store.upsertUser(user());
    const [appointment] = await store.createBatch("2026-07-15", [{ startTime: "10:00", endTime: "11:00", names: ["Kunde"] }], "oidc:alice");
    await store.updateAppointment(appointment!.id, 1, { assigneeId: "oidc:alice" });
    await expect(store.updateAppointment(appointment!.id, 1, { name: "Veraltet" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("entfernt vergangene Termine beim Tageswechsel", async () => {
    const file = await temporaryFile();
    let now = new Date("2026-07-15T08:00:00.000Z");
    const store = new StateStore(file, () => now, false);
    await store.initialize();
    await store.upsertUser(user());
    await store.createBatch("2026-07-15", [{ startTime: "12:00", endTime: "13:00", names: ["Alt"] }], "oidc:alice");
    now = new Date("2026-07-16T08:00:00.000Z");
    const snapshot = await store.getBootstrap("oidc:alice");
    expect(snapshot.appointments).toHaveLength(0);
    expect(snapshot.users).toHaveLength(1);
  });

  it("erlaubt alle fünf Planungstage und behält Monatswerte nach dem Tageswechsel", async () => {
    const file = await temporaryFile();
    let now = new Date("2026-07-15T08:00:00.000Z");
    const store = new StateStore(file, () => now, false);
    await store.initialize();
    await store.upsertUser(user());
    const dates = (await store.getBootstrap("oidc:alice")).dates;
    const [appointment] = await store.createBatch(
      dates.planningDays[4]!,
      [{ startTime: "08:00", endTime: "09:00", names: ["Kunde Zukunft"] }],
      "oidc:alice",
    );
    await store.updateAppointment(appointment!.id, appointment!.version, { assigneeId: "oidc:alice" });

    await expect(store.createBatch(
      "2026-07-22",
      [{ startTime: "08:00", endTime: "09:00", names: ["Zu weit"] }],
      "oidc:alice",
    )).rejects.toThrow("fünf angezeigten Planungstage");

    now = new Date("2026-08-03T08:00:00.000Z");
    const august = await store.getBootstrap("oidc:alice");
    expect(august.appointments).toHaveLength(0);
    expect(august.employeeOfMonth.month).toBe("2026-07");
    expect(august.employeeOfMonth.completedCount).toBe(1);
    expect(august.employeeOfMonth.leaders.map((leader) => leader.id)).toEqual(["oidc:alice"]);
    const raw = JSON.parse(await readFile(file, "utf8")) as {
      monthlyCompletions: Record<string, Record<string, number>>;
    };
    expect(raw.monthlyCompletions["2026-07"]?.["oidc:alice"]).toBe(1);
  });

  it("zählt einen zugewiesenen Termin erst nach dem Tageswechsel", async () => {
    const file = await temporaryFile();
    let now = new Date("2026-07-15T08:00:00.000Z");
    const store = new StateStore(file, () => now, false);
    await store.initialize();
    await store.upsertUser(user());
    const [appointment] = await store.createBatch(
      "2026-07-15",
      [{ startTime: "10:00", endTime: "11:00", names: ["Erledigt"] }],
      "oidc:alice",
    );
    await store.updateAppointment(appointment!.id, 1, { assigneeId: "oidc:alice" });
    expect((await store.getBootstrap("oidc:alice")).employeeOfMonth.completedCount).toBe(0);

    now = new Date("2026-07-16T08:00:00.000Z");
    expect((await store.getBootstrap("oidc:alice")).employeeOfMonth.completedCount).toBe(0);
    now = new Date("2026-08-01T08:00:00.000Z");
    const completed = await store.getBootstrap("oidc:alice");
    expect(completed.employeeOfMonth.month).toBe("2026-07");
    expect(completed.employeeOfMonth.completedCount).toBe(1);
    expect(completed.employeeOfMonth.leaders.map((leader) => leader.id)).toEqual(["oidc:alice"]);
  });

  it("zählt vor dem Tageswechsel aufgehobene oder gelöschte Zuweisungen nicht", async () => {
    const file = await temporaryFile();
    let now = new Date("2026-07-15T08:00:00.000Z");
    const store = new StateStore(file, () => now, false);
    await store.initialize();
    await store.upsertUser(user());
    const [first, second] = await store.createBatch(
      "2026-07-15",
      [{ startTime: "10:00", endTime: "11:00", names: ["A", "B"] }],
      "oidc:alice",
    );
    const assignedFirst = await store.updateAppointment(first!.id, 1, { assigneeId: "oidc:alice" });
    const assignedSecond = await store.updateAppointment(second!.id, 1, { assigneeId: "oidc:alice" });
    expect((await store.getBootstrap("oidc:alice")).employeeOfMonth.completedCount).toBe(0);

    await store.updateAppointment(assignedFirst.id, assignedFirst.version, { assigneeId: null });
    await store.deleteAppointment(assignedSecond.id, assignedSecond.version);
    now = new Date("2026-08-01T08:00:00.000Z");
    expect((await store.getBootstrap("oidc:alice")).employeeOfMonth.completedCount).toBe(0);
  });

  it("liefert bei gleicher Abschlusszahl alle Monatsführenden", async () => {
    const file = await temporaryFile();
    let now = new Date("2026-07-15T08:00:00.000Z");
    const store = new StateStore(file, () => now, false);
    await store.initialize();
    await store.upsertUser(user("oidc:alice"));
    await store.upsertUser(user("oidc:bob"));
    const [aliceAppointment, bobAppointment] = await store.createBatch(
      "2026-07-15",
      [{ startTime: "10:00", endTime: "11:00", names: ["A", "B"] }],
      "oidc:alice",
    );
    await store.updateAppointment(aliceAppointment!.id, 1, { assigneeId: "oidc:alice" });
    await store.updateAppointment(bobAppointment!.id, 1, { assigneeId: "oidc:bob" });
    now = new Date("2026-08-01T08:00:00.000Z");
    const result = await store.getBootstrap("oidc:alice");
    expect(result.employeeOfMonth.completedCount).toBe(1);
    expect(result.employeeOfMonth.leaders.map((leader) => leader.id)).toEqual(["oidc:alice", "oidc:bob"]);
  });

  it("entfernt Entwicklungsbenutzer im sicheren Modus", async () => {
    const file = await temporaryFile();
    const devStore = new StateStore(file, () => new Date("2026-07-15T08:00:00.000Z"), true);
    await devStore.initialize();
    await devStore.upsertUser(user("dev:local"));
    await devStore.createBatch("2026-07-15", [{ startTime: "08:00", endTime: "09:00", names: ["Dev-Test"] }], "dev:local");
    const productionStore = new StateStore(file, () => new Date("2026-07-15T08:00:00.000Z"), false);
    await productionStore.initialize();
    await expect(productionStore.getBootstrap("dev:local")).rejects.toThrow();
    const raw = JSON.parse(await readFile(file, "utf8")) as { users: unknown[]; appointments: unknown[] };
    expect(raw.users).toHaveLength(0);
    expect(raw.appointments).toHaveLength(0);
  });

  it("zählt vergangene Entwicklungstermine im Produktionsmodus nicht", async () => {
    const file = await temporaryFile();
    const devStore = new StateStore(file, () => new Date("2026-07-15T08:00:00.000Z"), true);
    await devStore.initialize();
    await devStore.upsertUser(user("oidc:alice"));
    await devStore.upsertUser(user("dev:local"));
    const [appointment] = await devStore.createBatch(
      "2026-07-15",
      [{ startTime: "08:00", endTime: "09:00", names: ["Dev-Termin"] }],
      "dev:local",
    );
    await devStore.updateAppointment(appointment!.id, 1, { assigneeId: "oidc:alice" });

    const productionStore = new StateStore(file, () => new Date("2026-07-16T08:00:00.000Z"), false);
    await productionStore.initialize();
    const result = await productionStore.getBootstrap("oidc:alice");
    expect(result.employeeOfMonth.completedCount).toBe(0);
  });
});
