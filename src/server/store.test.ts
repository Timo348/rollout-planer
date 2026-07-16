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
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(4);
  });

  it("migriert die ursprüngliche JSON-Struktur auf das aktuelle Schema", async () => {
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
    expect(snapshot.appointments).toHaveLength(1);
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(4);
    expect(raw).not.toHaveProperty("monthlyCompletions");
  });

  it("verwirft bei der Migration die nicht mehr benötigte Monatsstatistik", async () => {
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
    expect(snapshot.appointments).toHaveLength(0);
    const raw = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(raw.schemaVersion).toBe(4);
    expect(raw).not.toHaveProperty("monthlyAssignments");
    expect(raw).not.toHaveProperty("monthlyCompletions");
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

  it("erlaubt alle fünf Planungstage und entfernt vergangene Termine", async () => {
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

  it("löscht einen Benutzer und hebt seine Zuweisungen atomar auf", async () => {
    const file = await temporaryFile();
    const alice = user("oidc:alice");
    const bob = { ...user("oidc:bob"), username: "bob", displayName: "Bob Beispiel" };
    await writeFile(file, JSON.stringify({
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
    }), "utf8");

    const store = new StateStore(file, () => new Date("2026-07-15T09:30:00.000Z"), false);
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

    const persisted = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(persisted.schemaVersion).toBe(4);
    expect(persisted).not.toHaveProperty("monthlyCompletions");
  });
});
