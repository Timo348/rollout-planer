import { existsSync } from "node:fs";
import path from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { AppUser } from "../shared/contracts.js";
import { AuthService, OAUTH_FLOW_COOKIE, SESSION_COOKIE } from "./auth.js";
import type { AppConfig } from "./config.js";
import { MAX_APPOINTMENTS_PER_SLOT } from "./constants.js";
import {
  ConflictError,
  NotFoundError,
  StateStore,
  StateValidationError,
} from "./store.js";

declare module "fastify" {
  interface FastifyRequest {
    currentUser: AppUser | null;
  }
}

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeSchema = z.string().regex(timePattern, "Ungültige Uhrzeit.");

const createBatchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slots: z
    .array(
      z
        .object({
          startTime: timeSchema,
          endTime: timeSchema,
          names: z
            .array(z.string().trim().min(1, "Terminname darf nicht leer sein.").max(120))
            .min(1)
            .max(MAX_APPOINTMENTS_PER_SLOT),
        })
        .refine((slot) => slot.endTime > slot.startTime, {
          message: "Die Endzeit muss nach der Startzeit liegen.",
          path: ["endTime"],
        }),
    )
    .min(1, "Mindestens eine Uhrzeit auswählen.")
    .max(6),
});

const updateSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(120).optional(),
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    assigneeId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) =>
      value.startTime === undefined ||
      value.endTime === undefined ||
      value.endTime > value.startTime,
    { message: "Die Endzeit muss nach der Startzeit liegen.", path: ["endTime"] },
  );

const deleteSchema = z.object({ version: z.coerce.number().int().positive() });

function cookieOptions(config: AppConfig) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.secureCookies,
  };
}

function issues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

export async function buildApp(config: AppConfig, storeOverride?: StateStore) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.cookie", "res.headers.set-cookie"],
    },
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  });
  const store = storeOverride ?? new StateStore(config.dataFile, () => new Date(), config.devLoginEnabled);
  await store.initialize();
  const auth = new AuthService(config);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  app.decorateRequest("currentUser", null);

  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await auth.readSession(request.cookies[SESSION_COOKIE]);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized", message: "Bitte zuerst anmelden." });
    }
    request.currentUser = user;
  };

  const verifyOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
    const origin = request.headers.origin;
    if (origin && origin !== new URL(config.appBaseUrl).origin) {
      return reply.code(403).send({ error: "forbidden", message: "Ungültiger Anfrageursprung." });
    }
  };

  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  app.get("/api/session", async (request) => {
    const user = await auth.readSession(request.cookies[SESSION_COOKIE]);
    return {
      authenticated: Boolean(user),
      user,
      devLoginEnabled: config.devLoginEnabled,
      oidcEnabled: Boolean(config.oidc),
    };
  });

  app.get("/auth/login", async (_request, reply) => {
    try {
      const login = await auth.createAuthorizationRequest();
      reply.setCookie(OAUTH_FLOW_COOKIE, login.flowToken, {
        ...cookieOptions(config),
        path: "/auth",
        maxAge: 10 * 60,
      });
      return reply.redirect(login.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Anmeldung nicht verfügbar.";
      return reply.redirect(`/?authError=${encodeURIComponent(message)}`);
    }
  });

  app.get("/auth/callback", async (request, reply) => {
    try {
      const callbackUrl = new URL(request.raw.url ?? "/auth/callback", config.appBaseUrl);
      const user = await auth.completeAuthorization(
        callbackUrl,
        request.cookies[OAUTH_FLOW_COOKIE],
      );
      await store.upsertUser(user);
      const session = await auth.createSession(user);
      reply.clearCookie(OAUTH_FLOW_COOKIE, { ...cookieOptions(config), path: "/auth" });
      reply.setCookie(SESSION_COOKIE, session, {
        ...cookieOptions(config),
        maxAge: config.sessionTtlHours * 60 * 60,
      });
      return reply.redirect("/");
    } catch (error) {
      reply.clearCookie(OAUTH_FLOW_COOKIE, { ...cookieOptions(config), path: "/auth" });
      const message = error instanceof Error ? error.message : "Anmeldung fehlgeschlagen.";
      return reply.redirect(`/?authError=${encodeURIComponent(message)}`);
    }
  });

  app.post("/api/auth/dev-login", { preHandler: [verifyOrigin] }, async (_request, reply) => {
    if (!config.devLoginEnabled) {
      return reply.code(404).send({ error: "not_found", message: "Nicht gefunden." });
    }
    const user = auth.createDevUser();
    await store.upsertUser(user);
    const session = await auth.createSession(user);
    reply.setCookie(SESSION_COOKIE, session, {
      ...cookieOptions(config),
      maxAge: config.sessionTtlHours * 60 * 60,
    });
    return { user };
  });

  app.post("/api/auth/logout", { preHandler: [verifyOrigin] }, async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions(config));
    return reply.code(204).send();
  });

  app.get("/api/bootstrap", { preHandler: [authenticate] }, async (request) =>
    store.getBootstrap(request.currentUser!.id),
  );

  app.post(
    "/api/appointments/batch",
    { preHandler: [authenticate, verifyOrigin] },
    async (request, reply) => {
      const payload = createBatchSchema.parse(request.body);
      const created = await store.createBatch(payload.date, payload.slots, request.currentUser!.id);
      return reply.code(201).send({ appointments: created });
    },
  );

  app.patch(
    "/api/appointments/:id",
    { preHandler: [authenticate, verifyOrigin] },
    async (request) => {
      const id = z.string().min(1).parse((request.params as { id?: string }).id);
      const payload = updateSchema.parse(request.body);
      const appointment = (await store.getBootstrap(request.currentUser!.id)).appointments.find(
        (entry) => entry.id === id,
      );
      if (!appointment) throw new NotFoundError();
      const startTime = payload.startTime ?? appointment.startTime;
      const endTime = payload.endTime ?? appointment.endTime;
      if (endTime <= startTime) {
        throw new StateValidationError("Die Endzeit muss nach der Startzeit liegen.");
      }
      return store.updateAppointment(id, payload.version, {
        name: payload.name,
        startTime: payload.startTime,
        endTime: payload.endTime,
        assigneeId: payload.assigneeId,
      });
    },
  );

  app.delete(
    "/api/appointments/:id",
    { preHandler: [authenticate, verifyOrigin] },
    async (request, reply) => {
      const id = z.string().min(1).parse((request.params as { id?: string }).id);
      const query = deleteSchema.parse(request.query);
      await store.deleteAppointment(id, query.version);
      return reply.code(204).send();
    },
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "validation",
        message: "Bitte Eingaben prüfen.",
        issues: issues(error),
      });
    }
    if (error instanceof ConflictError) {
      return reply.code(409).send({
        error: "conflict",
        message: error.message,
        current: error.current,
      });
    }
    if (error instanceof NotFoundError) {
      return reply.code(404).send({ error: "not_found", message: error.message });
    }
    if (error instanceof StateValidationError) {
      return reply.code(400).send({ error: "validation", message: error.message });
    }
    app.log.error(error);
    return reply.code(500).send({
      error: "internal",
      message: "Es ist ein unerwarteter Fehler aufgetreten.",
    });
  });

  const indexFile = path.join(config.staticDir, "index.html");
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      prefix: "/",
      wildcard: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/auth/")) {
        return reply.code(404).send({ error: "not_found", message: "Nicht gefunden." });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}
