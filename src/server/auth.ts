import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { AppUser } from "../shared/contracts.js";
import type { AppConfig, OidcConfig } from "./config.js";

export const SESSION_COOKIE = "rollout_session";
export const OAUTH_FLOW_COOKIE = "rollout_oauth_flow";

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface FlowPayload extends JWTPayload {
  state: string;
  nonce: string;
  verifier: string;
}

interface TokenResponse {
  id_token?: string;
  access_token?: string;
  error?: string;
  error_description?: string;
}

function base64UrlRandom(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function requiredString(payload: JWTPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class AuthService {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private metadataPromise: Promise<OidcMetadata> | null = null;

  constructor(private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.sessionSecret);
    this.issuer = `${config.appBaseUrl}/`;
  }

  async createSession(user: AppUser): Promise<string> {
    return new SignJWT({
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      source: user.source,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuer(this.issuer)
      .setAudience("rollout-app")
      .setIssuedAt()
      .setExpirationTime(`${this.config.sessionTtlHours}h`)
      .sign(this.key);
  }

  async readSession(token: string | undefined): Promise<AppUser | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        audience: "rollout-app",
        algorithms: ["HS256"],
      });
      if (!payload.sub) return null;
      const source = payload.source === "dev" ? "dev" : "oidc";
      if (source === "dev" && !this.config.devLoginEnabled) return null;
      return {
        id: payload.sub,
        username: requiredString(payload, "username") ?? payload.sub,
        displayName: requiredString(payload, "displayName") ?? payload.sub,
        email: requiredString(payload, "email"),
        source,
        lastSeenAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  createDevUser(): AppUser {
    return {
      id: `dev:${this.config.devLoginUsername}`,
      username: this.config.devLoginUsername,
      displayName: this.config.devLoginName,
      source: "dev",
      lastSeenAt: new Date().toISOString(),
    };
  }

  async createAuthorizationRequest(): Promise<{ url: string; flowToken: string }> {
    const oidc = this.requireOidc();
    const metadata = await this.getMetadata(oidc);
    const state = base64UrlRandom();
    const nonce = base64UrlRandom();
    const verifier = base64UrlRandom(48);
    const callbackUrl = `${this.config.appBaseUrl}/auth/callback`;
    const url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: oidc.clientId,
      redirect_uri: callbackUrl,
      scope: oidc.scopes,
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();

    const flowToken = await new SignJWT({ state, nonce, verifier })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(this.issuer)
      .setAudience("rollout-oauth-flow")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(this.key);

    return { url: url.toString(), flowToken };
  }

  async completeAuthorization(callbackUrl: URL, flowToken: string | undefined): Promise<AppUser> {
    if (!flowToken) throw new Error("Der Anmeldevorgang ist abgelaufen. Bitte erneut anmelden.");
    const oidc = this.requireOidc();
    const metadata = await this.getMetadata(oidc);
    const { payload } = await jwtVerify(flowToken, this.key, {
      issuer: this.issuer,
      audience: "rollout-oauth-flow",
      algorithms: ["HS256"],
    });
    const flow = payload as FlowPayload;
    const returnedState = callbackUrl.searchParams.get("state");
    const code = callbackUrl.searchParams.get("code");
    const oauthError = callbackUrl.searchParams.get("error");

    if (oauthError) {
      throw new Error(callbackUrl.searchParams.get("error_description") || "Authentik hat die Anmeldung abgelehnt.");
    }
    if (!code || !returnedState || returnedState !== flow.state) {
      throw new Error("Die Authentik-Antwort konnte nicht sicher verifiziert werden.");
    }

    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${this.config.appBaseUrl}/auth/callback`,
        client_id: oidc.clientId,
        client_secret: oidc.clientSecret,
        code_verifier: flow.verifier,
      }),
    });
    const tokens = (await tokenResponse.json()) as TokenResponse;
    if (!tokenResponse.ok || !tokens.id_token) {
      throw new Error(tokens.error_description || tokens.error || "Authentik hat kein ID-Token geliefert.");
    }

    const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
    const verified = await jwtVerify(tokens.id_token, jwks, {
      issuer: metadata.issuer,
      audience: oidc.clientId,
    });
    if (verified.payload.nonce !== flow.nonce || !verified.payload.sub) {
      throw new Error("Das Authentik-ID-Token konnte nicht sicher zugeordnet werden.");
    }

    const username =
      requiredString(verified.payload, "preferred_username") ??
      requiredString(verified.payload, "email") ??
      verified.payload.sub;
    return {
      id: `oidc:${verified.payload.sub}`,
      username,
      displayName: requiredString(verified.payload, "name") ?? username,
      email: requiredString(verified.payload, "email"),
      source: "oidc",
      lastSeenAt: new Date().toISOString(),
    };
  }

  private requireOidc(): OidcConfig {
    if (!this.config.oidc) throw new Error("Authentik ist für diese Installation nicht konfiguriert.");
    return this.config.oidc;
  }

  private getMetadata(oidc: OidcConfig): Promise<OidcMetadata> {
    if (!this.metadataPromise) {
      this.metadataPromise = this.discover(oidc).catch((error) => {
        this.metadataPromise = null;
        throw error;
      });
    }
    return this.metadataPromise;
  }

  private async discover(oidc: OidcConfig): Promise<OidcMetadata> {
    const discoveryUrl = new URL(".well-known/openid-configuration", oidc.issuer);
    const response = await fetch(discoveryUrl, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("Die Authentik-Konfiguration ist momentan nicht erreichbar.");
    const value = (await response.json()) as Partial<OidcMetadata>;
    if (
      !value.issuer ||
      !value.authorization_endpoint ||
      !value.token_endpoint ||
      !value.jwks_uri ||
      value.issuer.replace(/\/$/, "") !== oidc.issuer.replace(/\/$/, "")
    ) {
      throw new Error("Die Authentik-Discovery-Antwort ist ungültig oder gehört zu einem anderen Issuer.");
    }
    return value as OidcMetadata;
  }
}
