import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppUser } from "../shared/contracts.js";
import { ConflictError, StateStore } from "./store.js";
import { createTestDatabase, resetTestDatabase } from "./testdb.js";

const directories: string[] = [];
const stores: StateStore[] = [];
let databaseUrl: string;

beforeAll(async () => {
  databaseUrl = await createTestDatabase("rollout_test_store");
});

beforeEach(async () => {
  await resetTestDatabase(databaseUrl);
});

async function temporaryLegacyFile(contents?: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rollout-store-"));
  directories.push(directory);
  const file = path.join(directory, "state.json");
  if (contents !== undefined) {
    await writeFile(file, JSON.stringify(contents), "utf8");
  }
  return file;
}

function makeStore(now: () => Date, allowDevUsers = false, legacyDataFile?: string): StateStore {
  const store = new StateStore(databaseUrl, now, allowDevUsers, legacyDataFile);
  stores.push(store);
  return store;
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
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("StateStore", () => {
  it("persistiert aktuelle Termine in PostgreSQL und lädt sie nach Neustart", async () => {
    const now = () => new Date("2026-07-15T08:00:00.000Z");
    const first = makeStore(now);
    await first.initialize();
    await first.upsertUser(user());
    await first.createBatch("2026-07-15", [{ startTime: "08:00", endTime: "09:00", names: ["Kunde A", "Kunde B"] }], "oidc:alice");

    const second = makeStore(now);
    await second.initialize();
    const snapshot = await second.getBootstrap("oidc:alice");
    expect(snapshot.appointments.map((entry) => entry.name)).toEqual(["Kunde A", "Kunde B"]);
  });

  it("importiert einen bestehenden JSON-Bestand beim ersten Start", async () => {
    const legacy = await temporaryLegacyFile({
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
    });

    const now = () => new Date("2026-07-15T08:00:00.000Z");
    const store = makeStore(now, false, legacy);
    await store.initialize();
    const snapshot = await store.getBootstrap("oidc:alice");
    expect(snapshot.appointments).toHaveLength(1);

    await expect(readFile(legacy, "utf8")).rejects.toThrow();
    const backup = JSON.parse(await readFile(`${legacy}.migrated`, "utf8")) as Record<string, unknown>;
    expect(backup.schemaVersion).toBe(1);

    const restarted = makeStore(now, false, legacy);
    await restarted.initialize();
    expect((await restarted.getBootstrap("oidc:alice")).appointments).toHaveLength(1);
  });

  it("verwirft beim Import die nicht mehr benötigte Monatsstatistik und archiviert vergangene Termine", async () => {
    const legacy = await temporaryLegacyFile({
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
    });

    const store = makeStore(() => new Date("2026-07-15T08:00:00.000Z"), false, legacy);
    await store.initialize();
    const snapshot = await store.getBootstrap("oidc:alice");
    expect(snapshot.appointments).toHaveLength(0);

    const history = await store.getHistory("2026-06-30");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      appointmentId: "already-counted",
      name: "Bereits im Monatswert",
      assigneeId: "oidc:alice",
      assigneeUsername: "alice",
      assigneeDisplayName: "Alice Beispiel",
      reason: "abgelaufen",
    });
  });

  it("erkennt konkurrierende Änderungen über die Versionsnummer", async () => {
    const store = makeStore(() => new Date("2026-07-15T08:00:00.000Z"));
    await store.initialize();
    await store.upsertUser(user());
    const [appointment] = await store.createBatch("2026-07-15", [{ startTime: "10:00", endTime: "11:00", names: ["Kunde"] }], "oidc:alice");
    await store.updateAppointment(appointment!.id, 1, { assigneeId: "oidc:alice" });
    await expect(store.updateAppointment(appointment!.id, 1, { name: "Veraltet" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("entfernt vergangene Termine beim Tageswechsel und archiviert sie in der Tagestabelle", async () => {
    let now = new Date("2026-07-15T08:00:00.000Z");
    const store = makeStore(() => now);
    await store.initialize();
    await store.upsertUser(user());
    const [appointment] = await store.createBatch("2026-07-15", [{ startTime: "12:00", endTime: "13:00", names: ["Alt"] }], "oidc:alice");
    await store.updateAppointment(appointment!.id, 1, { assigneeId: "oidc:alice" });

    now = new Date("2026-07-16T08:00:00.000Z");
    const snapshot = await store.getBootstrap("oidc:alice");
    expect(snapshot.appointments).toHaveLength(0);
    expect(snapshot.users).toHaveLength(1);

    const history = await store.getHistory("2026-07-15");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      appointmentId: appointment!.id,
      date: "2026-07-15",
      startTime: "12:00",
      endTime: "13:00",
      name: "Alt",
      assigneeId: "oidc:alice",
      assigneeUsername: "alice",
      assigneeDisplayName: "Alice Beispiel",
      reason: "abgelaufen",
    });
    expect(await store.getHistory("2026-07-16")).toEqual([]);
  });

  it("erlaubt alle fünf Planungstage und entfernt vergangene Termine", async () => {
    let now = new Date("2026-07-15T08:00:00.000Z");
    const store = makeStore(() => now);
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
    expect(await store.getHistory(dates.planningDays[4]!)).toHaveLength(1);
  });

  it("entfernt Entwicklungsbenutzer im sicheren Modus und archiviert ihre Termine", async () => {
    const now = () => new Date("2026-07-15T08:00:00.000Z");
    const devStore = makeStore(now, true);
    await devStore.initialize();
    await devStore.upsertUser(user("dev:local"));
    await devStore.createBatch("2026-07-15", [{ startTime: "08:00", endTime: "09:00", names: ["Dev-Test"] }], "dev:local");

    const productionStore = makeStore(now, false);
    await productionStore.initialize();
    await expect(productionStore.getBootstrap("dev:local")).rejects.toThrow();

    const history = await productionStore.getHistory("2026-07-15");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ name: "Dev-Test", createdBy: "dev:local", reason: "dev-bereinigung" });
  });

  it("löscht einen Benutzer und hebt seine Zuweisungen atomar auf", async () => {
    const alice = user("oidc:alice");
    const bob = { ...user("oidc:bob"), username: "bob", displayName: "Bob Beispiel" };
    const legacy = await temporaryLegacyFile({
      schemaVersion: 3,
      users: [alice, bob],
      appointments: [{
        id: "assigned-to-bob",
        date: "2026-07-15",
        startTime: "10:00",
        endTime: "11:00",
        name: "Kunde",
        assigneeId: "oidc:bob",
        createdBy: "oidc:bob",
        createdAt: "2026-07-14T08:00:00.000Z",
        updatedAt: "2026-07-14T08:00:00.000Z",
        version: 1,
      }],
      monthlyCompletions: {
        "2026-06": { "oidc:alice": 1, "oidc:bob": 4 },
      },
    });

    const store = makeStore(() => new Date("2026-07-15T09:30:00.000Z"), false, legacy);
    await store.initialize();
    const removed = await store.deleteUser("oidc:bob");
    const snapshot = await store.getBootstrap("oidc:alice");

    expect(removed).toMatchObject({ id: "oidc:bob", username: "bob" });
    await expect(store.getUser("oidc:bob")).rejects.toThrow("Benutzer wurde nicht gefunden");
    expect(snapshot.users.map((entry) => entry.id)).toEqual(["oidc:alice"]);
    expect(snapshot.appointments).toEqual([
      expect.objectContaining({
        id: "assigned-to-bob",
        assigneeId: null,
        createdBy: "oidc:bob",
        updatedAt: "2026-07-15T09:30:00.000Z",
        version: 2,
      }),
    ]);
  });

  it("archiviert ausdrücklich gelöschte Termine mit Begründung", async () => {
    const store = makeStore(() => new Date("2026-07-15T08:00:00.000Z"));
    await store.initialize();
    await store.upsertUser(user());
    const [appointment] = await store.createBatch("2026-07-15", [{ startTime: "10:00", endTime: "11:00", names: ["Kunde"] }], "oidc:alice");
    await store.updateAppointment(appointment!.id, 1, { assigneeId: "oidc:alice" });
    await store.deleteAppointment(appointment!.id, 2);

    expect((await store.getBootstrap("oidc:alice")).appointments).toHaveLength(0);
    const history = await store.getHistory("2026-07-15");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      name: "Kunde",
      assigneeId: "oidc:alice",
      assigneeDisplayName: "Alice Beispiel",
      reason: "gelöscht",
    });
  });
});
