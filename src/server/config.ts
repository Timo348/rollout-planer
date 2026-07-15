import path from "node:path";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

export interface AppConfig {
  appMode: "development" | "production";
  host: string;
  port: number;
  appBaseUrl: string;
  dataFile: string;
  staticDir: string;
  sessionSecret: string;
  sessionTtlHours: number;
  secureCookies: boolean;
  trustProxy: boolean;
  devLoginEnabled: boolean;
  devLoginName: string;
  devLoginUsername: string;
  oidc: OidcConfig | null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const appMode = env.APP_MODE === "development" ? "development" : "production";
  const appBaseUrl = (env.APP_BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
  const sessionSecret = env.SESSION_SECRET ?? "";

  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET muss mindestens 32 Zeichen lang sein.");
  }

  try {
    new URL(appBaseUrl);
  } catch {
    throw new Error("APP_BASE_URL ist keine gültige URL.");
  }

  const devLoginEnabled =
    appMode === "development" && parseBoolean(env.DEV_LOGIN_ENABLED, false);
  const hasOidc = Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);

  if (!devLoginEnabled && !hasOidc) {
    throw new Error(
      "Authentik ist nicht konfiguriert. Setze OIDC_ISSUER, OIDC_CLIENT_ID und OIDC_CLIENT_SECRET.",
    );
  }

  return {
    appMode,
    host: env.HOST ?? "0.0.0.0",
    port: parsePositiveNumber(env.PORT, 8080),
    appBaseUrl,
    dataFile: path.resolve(env.DATA_FILE ?? "./data/rollout-state.json"),
    staticDir: path.resolve(env.STATIC_DIR ?? "./dist/public"),
    sessionSecret,
    sessionTtlHours: parsePositiveNumber(env.SESSION_TTL_HOURS, 12),
    secureCookies: parseBoolean(env.SESSION_COOKIE_SECURE, appBaseUrl.startsWith("https://")),
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    devLoginEnabled,
    devLoginName: env.DEV_LOGIN_NAME?.trim() || "Entwickler",
    devLoginUsername: env.DEV_LOGIN_USERNAME?.trim() || "dev",
    oidc: hasOidc
      ? {
          issuer: env.OIDC_ISSUER!.replace(/\/$/, "") + "/",
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET!,
          scopes: env.OIDC_SCOPES?.trim() || "openid profile email",
        }
      : null,
  };
}
