import type { AppUser, ChangeNotice } from "../shared/contracts.js";
import type { MailMessage, MailTransport } from "./mailer.js";

export interface ChangeNoticeMailResult {
  sent: number;
  failed: number;
}

function buildChangeNoticeMail(recipient: AppUser, notice: ChangeNotice): MailMessage {
  return {
    to: recipient.email!,
    subject: "Neue Änderung im Rollout Planer",
    text: [
      `Hallo ${recipient.displayName},`,
      "",
      `${notice.publishedByName} hat eine neue Änderung im Rollout Planer veröffentlicht:`,
      "",
      notice.content,
      "",
      "Viele Grüße",
      "dein Rollout-Planer",
    ].join("\n"),
  };
}

export async function sendChangeNoticeMails(
  users: AppUser[],
  notice: ChangeNotice,
  transport: MailTransport<MailMessage>,
): Promise<ChangeNoticeMailResult> {
  const recipients = users.filter(
    (user) =>
      user.id !== notice.publishedBy &&
      Boolean(user.email) &&
      user.changeNoticeMailsEnabled !== false,
  );
  const results = await Promise.allSettled(
    recipients.map((recipient) =>
      Promise.resolve().then(() => transport(buildChangeNoticeMail(recipient, notice))),
    ),
  );
  const sent = results.filter((result) => result.status === "fulfilled").length;
  return { sent, failed: results.length - sent };
}
