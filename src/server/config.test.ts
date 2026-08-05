import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

function baseEnv(): NodeJS.ProcessEnv {
  return {
    APP_MODE: "development",
    APP_BASE_URL: "http://localhost:8080",
    SESSION_SECRET: "test-session-secret-with-at-least-thirty-two-characters",
    DEV_LOGIN_ENABLED: "true",
  };
}

describe("Konfiguration", () => {
  it("übernimmt eine HTTP- oder HTTPS-Adresse für die Anleitung", () => {
    expect(loadConfig({ ...baseEnv(), GUIDE_URL: "https://wiki.example.test/anleitung" }).guideUrl)
      .toBe("https://wiki.example.test/anleitung");
  });

  it("blendet die Anleitung ohne konfigurierte Adresse aus", () => {
    expect(loadConfig(baseEnv()).guideUrl).toBeNull();
  });

  it("weist unsichere oder ungültige Anleitungsadressen zurück", () => {
    expect(() => loadConfig({ ...baseEnv(), GUIDE_URL: "javascript:alert(1)" }))
      .toThrow("GUIDE_URL muss eine HTTP- oder HTTPS-URL sein");
    expect(() => loadConfig({ ...baseEnv(), GUIDE_URL: "keine-url" }))
      .toThrow("GUIDE_URL ist keine gültige URL");
  });
});
