import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BootstrapResponse } from "../shared/contracts.js";
import { buildApp } from "./app.js";
import type { AppConfig } from "./config.js";

const directories: string[] = [];
const apps: FastifyInstance[] = [];

beforeAll(() => {
  process.env.LOG_LEVEL = "silent";
});

async function testConfig(devLoginEnabled = true): Promise<AppConfig> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rollout-api-"));
  directories.push(directory);
  return {
    appMode: devLoginEnabled ? "development" : "production",
    host: "127.0.0.1",
    port: 0,
    appBaseUrl: "http://localhost:8080",
    dataFile: path.join(directory, "state.json"),
    staticDir: path.join(directory, "public"),
    sessionSecret: "test-session-secret-with-at-least-thirty-two-characters",
    sessionTtlHours: 12,
    secureCookies: false,
    trustProxy: false,
    devLoginEnabled,
    devLoginName: "Entwickler",
    devLoginUsername: "dev",
    oidc: null,
  };
}

async function createApp(devLoginEnabled = true): Promise<FastifyInstance> {
  const app = await buildApp(await testConfig(devLoginEnabled));
  apps.push(app);
  return app;
}

function cookieFrom(response: { headers: Record<string, string | string[] | number | undefined> }): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("Kein Session-Cookie erhalten.");
  return String(first).split(";")[0]!;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Rollout API", () => {
  it("schützt die Terminübersicht ohne Anmeldung", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(response.statusCode).toBe(401);
  });

  it("stellt den Dev-Login nur im ausdrücklich aktivierten Entwicklungsmodus bereit", async () => {
    const enabled = await createApp(true);
    const login = await enabled.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "http://localhost:8080" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toBeTruthy();

    const disabled = await createApp(false);
    const denied = await disabled.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "http://localhost:8080" },
    });
    expect(denied.statusCode).toBe(404);
  });

  it("erstellt feste und eigene Termine und erlaubt mehrere parallele Zuweisungen", async () => {
    const app = await createApp();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "http://localhost:8080" },
    });
    const cookie = cookieFrom(login);
    const firstBootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } });
    const initial = firstBootstrap.json<BootstrapResponse>();
    expect(initial.fixedSlots).toEqual([
      { startTime: "08:00", endTime: "09:00" },
      { startTime: "10:00", endTime: "11:00" },
      { startTime: "11:00", endTime: "12:00" },
      { startTime: "12:00", endTime: "13:00" },
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/api/appointments/batch",
      headers: { cookie, origin: "http://localhost:8080", "content-type": "application/json" },
      payload: {
        date: initial.dates.today,
        slots: [
          { startTime: "08:00", endTime: "09:00", names: ["A", "B", "C", "D", "E"] },
          { startTime: "09:15", endTime: "09:45", names: ["Eigene Uhrzeit"] },
        ],
      },
    });
    expect(created.statusCode).toBe(201);

    let bootstrap = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json<BootstrapResponse>();
    expect(bootstrap.appointments).toHaveLength(6);
    const [first, second] = bootstrap.appointments;
    for (const appointment of [first!, second!]) {
      const update = await app.inject({
        method: "PATCH",
        url: `/api/appointments/${appointment.id}`,
        headers: { cookie, origin: "http://localhost:8080", "content-type": "application/json" },
        payload: { version: appointment.version, assigneeId: initial.currentUser.id },
      });
      expect(update.statusCode).toBe(200);
    }
    bootstrap = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json<BootstrapResponse>();
    expect(bootstrap.appointments.filter((appointment) => appointment.assigneeId === initial.currentUser.id)).toHaveLength(2);
  });

  it("weist browserfremde Schreibzugriffe ab", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "https://fremd.example" },
    });
    expect(response.statusCode).toBe(403);
  });
});
