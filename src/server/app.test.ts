import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AppUser, BootstrapResponse } from "../shared/contracts.js";
import { buildApp } from "./app.js";
import { AuthService, SESSION_COOKIE, type SessionPrincipal } from "./auth.js";
import type { AppConfig } from "./config.js";
import { StateStore } from "./store.js";
import { createTestDatabase, resetTestDatabase } from "./testdb.js";

const directories: string[] = [];
const apps: FastifyInstance[] = [];
let databaseUrl: string;

beforeAll(async () => {
  process.env.LOG_LEVEL = "silent";
  databaseUrl = await createTestDatabase("rollout_test_app");
});

beforeEach(async () => {
  await resetTestDatabase(databaseUrl);
});

async function testConfig(devLoginEnabled = true): Promise<AppConfig> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "rollout-api-"));
  directories.push(directory);
  return {
    appMode: devLoginEnabled ? "development" : "production",
    host: "127.0.0.1",
    port: 0,
    appBaseUrl: "http://localhost:8080",
    databaseUrl,
    dataFile: path.join(directory, "state.json"),
    staticDir: path.join(directory, "public"),
    sessionSecret: "test-session-secret-with-at-least-thirty-two-characters",
    sessionTtlHours: 12,
    secureCookies: false,
    trustProxy: false,
    devLoginEnabled,
    devLoginName: "Entwickler",
    devLoginUsername: "dev",
    adminLoginEnabled: true,
    adminUsername: "admin",
    adminPassword: "admin",
    oidc: null,
    smtp: null,
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

function oidcUser(id: string, username: string): AppUser {
  return {
    id,
    username,
    displayName: `${username} Beispiel`,
    source: "oidc",
    lastSeenAt: "2026-07-15T08:00:00.000Z",
  };
}

async function sessionCookie(config: AppConfig, principal: SessionPrincipal): Promise<string> {
  return `${SESSION_COOKIE}=${await new AuthService(config).createSession(principal)}`;
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
    expect(initial.permissions).toEqual({ manageUsers: true });
    expect(initial.dates.planningDays).toHaveLength(5);
    expect(initial.fixedSlots).toEqual([
      { startTime: "08:00", endTime: "09:00" },
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "10:00", endTime: "11:00" },
      { startTime: "11:00", endTime: "12:00" },
      { startTime: "12:00", endTime: "13:00" },
      { startTime: "13:00", endTime: "14:00" },
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

  it("meldet den lokalen Administrator mit Benutzername und Passwort an", async () => {
    const app = await createApp();
    const wrong = await app.inject({
      method: "POST",
      url: "/api/auth/admin-login",
      headers: { origin: "http://localhost:8080", "content-type": "application/json" },
      payload: { username: "admin", password: "falsch" },
    });
    expect(wrong.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/admin-login",
      headers: { origin: "http://localhost:8080", "content-type": "application/json" },
      payload: { username: "admin", password: "admin" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json<{ user: AppUser }>().user).toMatchObject({
      id: "local:admin",
      username: "admin",
      source: "local",
    });

    const cookie = cookieFrom(login);
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json<BootstrapResponse>().permissions).toEqual({ manageUsers: true });

    const session = await app.inject({ method: "GET", url: "/api/session" });
    expect(session.json()).toMatchObject({ adminLoginEnabled: true });
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

  it("versendet die Tagesagenda manuell nur mit Berechtigung und konfiguriertem SMTP", async () => {
    const config = await testConfig(true);
    const store = new StateStore(config.databaseUrl, () => new Date("2026-07-15T08:00:00.000Z"), true, config.dataFile);
    await store.initialize();
    const bob = oidcUser("oidc:bob", "bob");
    await store.upsertUser(bob);
    const app = await buildApp(config, store);
    apps.push(app);

    const bobCookie = await sessionCookie(config, {
      user: bob,
      permissions: { manageUsers: false },
    });
    const devLogin = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "http://localhost:8080" },
    });
    const adminCookie = cookieFrom(devLogin);

    const anonymous = await app.inject({
      method: "POST",
      url: "/api/agenda/send",
      headers: { origin: "http://localhost:8080" },
    });
    expect(anonymous.statusCode).toBe(401);

    const forbidden = await app.inject({
      method: "POST",
      url: "/api/agenda/send",
      headers: { cookie: bobCookie, origin: "http://localhost:8080" },
    });
    expect(forbidden.statusCode).toBe(403);

    const withoutSmtp = await app.inject({
      method: "POST",
      url: "/api/agenda/send",
      headers: { cookie: adminCookie, origin: "http://localhost:8080" },
    });
    expect(withoutSmtp.statusCode).toBe(503);
    expect(withoutSmtp.json<{ message: string }>().message).toContain("SMTP_HOST");
  });

  it("liefert archivierte Termine vergangener Tage und speichert die eigene Mail-Einstellung", async () => {
    const config = await testConfig(true);
    await writeFile(config.dataFile, JSON.stringify({
      schemaVersion: 4,
      users: [],
      appointments: [{
        id: "past-1",
        date: "2026-07-10",
        startTime: "08:00",
        endTime: "09:00",
        name: "Kunde Alt",
        assigneeId: null,
        createdBy: "oidc:archiv",
        createdAt: "2026-07-09T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
        version: 1,
      }],
    }), "utf8");
    const store = new StateStore(config.databaseUrl, () => new Date("2026-07-15T08:00:00.000Z"), true, config.dataFile);
    await store.initialize();
    const app = await buildApp(config, store);
    apps.push(app);

    const anonymous = await app.inject({ method: "GET", url: "/api/history/2026-07-10" });
    expect(anonymous.statusCode).toBe(401);

    const devLogin = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "http://localhost:8080" },
    });
    const cookie = cookieFrom(devLogin);

    const invalid = await app.inject({ method: "GET", url: "/api/history/10-07-2026", headers: { cookie } });
    expect(invalid.statusCode).toBe(400);

    const history = await app.inject({ method: "GET", url: "/api/history/2026-07-10", headers: { cookie } });
    expect(history.statusCode).toBe(200);
    const { entries } = history.json<{ entries: Array<Record<string, unknown>> }>();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "Kunde Alt", date: "2026-07-10", reason: "abgelaufen" });

    const updated = await app.inject({
      method: "PUT",
      url: "/api/users/me/preferences",
      headers: { cookie, origin: "http://localhost:8080", "content-type": "application/json" },
      payload: { agendaMailsEnabled: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json<{ user: AppUser }>().user.agendaMailsEnabled).toBe(false);

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } });
    expect(bootstrap.json<BootstrapResponse>().currentUser.agendaMailsEnabled).toBe(false);
  });

  it("liefert die Terminstatistik nur für Admins und lässt manuelle Korrekturen zu", async () => {
    const config = await testConfig(true);
    await writeFile(config.dataFile, JSON.stringify({
      schemaVersion: 4,
      users: [{
        id: "dev:dev",
        username: "dev",
        displayName: "Entwickler",
        source: "dev",
        lastSeenAt: "2026-07-09T08:00:00.000Z",
      }],
      appointments: [{
        id: "past-1",
        date: "2026-07-10",
        startTime: "08:00",
        endTime: "09:00",
        name: "Kunde Alt",
        assigneeId: "dev:dev",
        createdBy: "dev:dev",
        createdAt: "2026-07-09T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
        version: 1,
      }],
    }), "utf8");
    const store = new StateStore(config.databaseUrl, () => new Date("2026-07-15T08:00:00.000Z"), true, config.dataFile);
    await store.initialize();
    const bob = oidcUser("oidc:bob", "bob");
    await store.upsertUser(bob);
    const app = await buildApp(config, store);
    apps.push(app);

    const anonymous = await app.inject({ method: "GET", url: "/api/stats/assignments?period=all" });
    expect(anonymous.statusCode).toBe(401);

    const bobCookie = await sessionCookie(config, {
      user: bob,
      permissions: { manageUsers: false },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/stats/assignments?period=all",
      headers: { cookie: bobCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const devLogin = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "http://localhost:8080" },
    });
    const adminCookie = cookieFrom(devLogin);

    const stats = await app.inject({
      method: "GET",
      url: "/api/stats/assignments?period=all",
      headers: { cookie: adminCookie },
    });
    expect(stats.statusCode).toBe(200);
    const { entries } = stats.json<{ entries: Array<Record<string, unknown>> }>();
    expect(entries.find((entry) => entry.userId === "dev:dev")).toMatchObject({
      appointments: 1,
      adjustment: 0,
      total: 1,
    });

    const adjust = await app.inject({
      method: "POST",
      url: "/api/stats/assignments/dev%3Adev/adjust",
      headers: { cookie: adminCookie, origin: "http://localhost:8080", "content-type": "application/json" },
      payload: { delta: 2 },
    });
    expect(adjust.statusCode).toBe(200);
    expect(adjust.json<{ user: AppUser }>().user.statsAdjustment).toBe(2);

    const adjustedStats = await app.inject({
      method: "GET",
      url: "/api/stats/assignments?period=all",
      headers: { cookie: adminCookie },
    });
    expect(
      adjustedStats.json<{ entries: Array<Record<string, unknown>> }>().entries
        .find((entry) => entry.userId === "dev:dev"),
    ).toMatchObject({ appointments: 1, adjustment: 2, total: 3 });

    const forbiddenAdjust = await app.inject({
      method: "POST",
      url: "/api/stats/assignments/dev%3Adev/adjust",
      headers: { cookie: bobCookie, origin: "http://localhost:8080", "content-type": "application/json" },
      payload: { delta: 1 },
    });
    expect(forbiddenAdjust.statusCode).toBe(403);

    const invalidPeriod = await app.inject({
      method: "GET",
      url: "/api/stats/assignments?period=year",
      headers: { cookie: adminCookie },
    });
    expect(invalidPeriod.statusCode).toBe(400);
  });

  it("schützt die Benutzerlöschung serverseitig und sperrt die Sitzung des entfernten Benutzers", async () => {
    const config = await testConfig(true);
    const store = new StateStore(config.databaseUrl, () => new Date("2026-07-15T08:00:00.000Z"), true, config.dataFile);
    await store.initialize();
    const bob = oidcUser("oidc:bob", "bob");
    await store.upsertUser(bob);
    const app = await buildApp(config, store);
    apps.push(app);

    const bobCookie = await sessionCookie(config, {
      user: bob,
      permissions: { manageUsers: false },
    });
    const devLogin = await app.inject({
      method: "POST",
      url: "/api/auth/dev-login",
      headers: { origin: "http://localhost:8080" },
    });
    const adminCookie = cookieFrom(devLogin);

    const forbidden = await app.inject({
      method: "DELETE",
      url: "/api/users/dev%3Adev",
      headers: { cookie: bobCookie, origin: "http://localhost:8080" },
    });
    expect(forbidden.statusCode).toBe(403);

    const selfDelete = await app.inject({
      method: "DELETE",
      url: "/api/users/dev%3Adev",
      headers: { cookie: adminCookie, origin: "http://localhost:8080" },
    });
    expect(selfDelete.statusCode).toBe(409);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/users/oidc%3Abob",
      headers: { cookie: adminCookie, origin: "http://localhost:8080" },
    });
    expect(deleted.statusCode).toBe(204);
    await expect(store.getUser("oidc:bob")).rejects.toThrow("Benutzer wurde nicht gefunden");

    const staleSession = await app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: bobCookie },
    });
    expect(staleSession.json()).toMatchObject({ authenticated: false, user: null });
    const staleBootstrap = await app.inject({
      method: "GET",
      url: "/api/bootstrap",
      headers: { cookie: bobCookie },
    });
    expect(staleBootstrap.statusCode).toBe(401);
  });
});
