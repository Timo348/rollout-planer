import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SmtpConfig } from "./config.js";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(async () => undefined),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mocks.sendMail })),
  },
}));

import { createSmtpTransport } from "./mailer.js";

const config: SmtpConfig = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  user: null,
  pass: null,
  from: "rollout-planer@example.com",
};

describe("SMTP-Transport", () => {
  beforeEach(() => {
    mocks.sendMail.mockClear();
  });

  it("hängt an reine Textmails keine Kalendereinladung an", async () => {
    const transport = createSmtpTransport(config);
    await transport({
      to: "alice@example.com",
      subject: "Neue Änderung",
      text: "Eine neue Meldung.",
    });

    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: config.from,
      to: "alice@example.com",
      subject: "Neue Änderung",
      text: "Eine neue Meldung.",
    });
  });

  it("behält Kalendereinladungen für Terminmails bei", async () => {
    const transport = createSmtpTransport(config);
    await transport({
      to: "alice@example.com",
      subject: "Termin",
      text: "Ein Termin.",
      ics: "BEGIN:VCALENDAR\nEND:VCALENDAR",
      icsFileName: "termin.ics",
    });

    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      icalEvent: {
        method: "REQUEST",
        filename: "termin.ics",
        content: "BEGIN:VCALENDAR\nEND:VCALENDAR",
      },
    }));
  });
});
