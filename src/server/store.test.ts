import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    expect(JSON.parse(await readFile(file, "utf8")).schemaVersion).toBe(1);
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
});
