import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { AuthService, permissionsFromClaims } from "./auth.js";

function config(): AppConfig {
  return {
    appMode: "development",
    host: "127.0.0.1",
    port: 8080,
    appBaseUrl: "http://localhost:8080",
    databaseUrl: "postgres://postgres:postgres@localhost:5432/rollout",
    dataFile: "state.json",
    staticDir: "public",
    sessionSecret: "test-session-secret-with-at-least-thirty-two-characters",
    sessionTtlHours: 12,
    secureCookies: false,
    trustProxy: false,
    devLoginEnabled: true,
    devLoginName: "Entwickler",
    devLoginUsername: "dev",
    adminLoginEnabled: true,
    adminUsername: "admin",
    adminPassword: "admin",
    oidc: null,
    smtp: null,
  };
}

describe("Authentifizierung und Berechtigungen", () => {
  it("erteilt die Benutzerverwaltung nur beim exakten Authentik-Gruppennamen", () => {
    expect(permissionsFromClaims({ groups: ["rollout-planner-admin"] }).manageUsers).toBe(true);
    expect(permissionsFromClaims({ groups: ["Rollout-Planner-Admin"] }).manageUsers).toBe(false);
    expect(permissionsFromClaims({ groups: ["rollout-planner-admins"] }).manageUsers).toBe(false);
  });

  it("behandelt einen fehlenden oder nicht vollständig aus Strings bestehenden Claim als unberechtigt", () => {
    expect(permissionsFromClaims({}).manageUsers).toBe(false);
    expect(permissionsFromClaims({ groups: "rollout-planner-admin" }).manageUsers).toBe(false);
    expect(permissionsFromClaims({ groups: ["rollout-planner-admin", 42] }).manageUsers).toBe(false);
  });

  it("bewahrt die Berechtigung ausschließlich in der signierten Sitzung", async () => {
    const auth = new AuthService(config());
    const principal = auth.createDevUser();
    const token = await auth.createSession(principal);
    const restored = await auth.readSession(token);

    expect(restored?.user).toMatchObject({ id: "dev:dev", source: "dev" });
    expect(restored?.permissions).toEqual({ manageUsers: true });
    expect(restored?.user).not.toHaveProperty("permissions");
    expect(restored?.user).not.toHaveProperty("groups");
  });

  it("behandelt ältere Sitzungen ohne Berechtigungsclaim sicher als nicht administrativ", async () => {
    const appConfig = config();
    const key = new TextEncoder().encode(appConfig.sessionSecret);
    const token = await new SignJWT({
      username: "alice",
      displayName: "Alice",
      source: "oidc",
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("oidc:alice")
      .setIssuer(`${appConfig.appBaseUrl}/`)
      .setAudience("rollout-app")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);

    expect((await new AuthService(appConfig).readSession(token))?.permissions).toEqual({
      manageUsers: false,
    });
  });
});
