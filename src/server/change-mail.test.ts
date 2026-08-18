import { describe, expect, it, vi } from "vitest";
import type { AppUser, ChangeNotice } from "../shared/contracts.js";
import { sendChangeNoticeMails } from "./change-mail.js";
import type { MailMessage } from "./mailer.js";

function user(
  id: string,
  email?: string,
  changeNoticeMailsEnabled?: boolean,
): AppUser {
  return {
    id,
    username: id.split(":")[1]!,
    displayName: `${id.split(":")[1]} Beispiel`,
    ...(email ? { email } : {}),
    source: "oidc",
    lastSeenAt: "2026-08-18T12:00:00.000Z",
    isPreparer: false,
    ...(changeNoticeMailsEnabled !== undefined ? { changeNoticeMailsEnabled } : {}),
  };
}

const notice: ChangeNotice = {
  id: "17",
  content: "Die neue Anleitung ist jetzt verfügbar.",
  publishedAt: "2026-08-18T12:30:00.000Z",
  publishedBy: "oidc:author",
  publishedByName: "author Beispiel",
};

describe("E-Mails zu Änderungsmeldungen", () => {
  it("sendet je aktivem anderen Profil genau eine Klartextmail", async () => {
    const mails: MailMessage[] = [];
    const result = await sendChangeNoticeMails(
      [
        user("oidc:author", "author@example.com"),
        user("oidc:default", "default@example.com"),
        user("oidc:enabled", "enabled@example.com", true),
        user("oidc:disabled", "disabled@example.com", false),
        user("oidc:no-mail"),
      ],
      notice,
      async (mail) => {
        mails.push(mail);
      },
    );

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(mails.map((mail) => mail.to)).toEqual([
      "default@example.com",
      "enabled@example.com",
    ]);
    expect(mails[0]).toEqual({
      to: "default@example.com",
      subject: "Neue Änderung im Rollout Planer",
      text: expect.stringContaining(notice.content),
    });
    expect(mails[0]).not.toHaveProperty("ics");
    expect(mails[0]).not.toHaveProperty("icsFileName");
  });

  it("versucht alle Empfänger und fasst einzelne Versandfehler zusammen", async () => {
    const transport = vi.fn(async (mail: MailMessage) => {
      if (mail.to === "broken@example.com") throw new Error("SMTP nicht erreichbar");
    });

    const result = await sendChangeNoticeMails(
      [
        user("oidc:broken", "broken@example.com"),
        user("oidc:working", "working@example.com"),
      ],
      notice,
      transport,
    );

    expect(transport).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 1, failed: 1 });
  });
});
