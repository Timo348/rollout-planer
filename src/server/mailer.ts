import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config.js";

export interface AgendaMail {
  to: string;
  subject: string;
  text: string;
  ics: string;
  icsFileName: string;
}

export type MailTransport = (mail: AgendaMail) => Promise<void>;

export function createSmtpTransport(config: SmtpConfig): MailTransport {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user ? { auth: { user: config.user, pass: config.pass ?? "" } } : {}),
  });
  return async (mail) => {
    await transporter.sendMail({
      from: config.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      icalEvent: {
        method: "REQUEST",
        filename: mail.icsFileName,
        content: mail.ics,
      },
    });
  };
}
