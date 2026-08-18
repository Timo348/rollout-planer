import nodemailer from "nodemailer";
import type { SmtpConfig } from "./config.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface AgendaMail extends MailMessage {
  ics: string;
  icsFileName: string;
}

export type MailTransport<TMessage extends MailMessage = AgendaMail> = (
  mail: TMessage,
) => Promise<void>;

export type SmtpMailMessage = MailMessage | AgendaMail;

function isAgendaMail(mail: MailMessage): mail is AgendaMail {
  return "ics" in mail && "icsFileName" in mail;
}

export function createSmtpTransport(config: SmtpConfig): MailTransport<SmtpMailMessage> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    ...(config.user ? { auth: { user: config.user, pass: config.pass ?? "" } } : {}),
  });
  return async (mail) => {
    await transporter.sendMail({
      from: config.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(isAgendaMail(mail)
        ? {
            icalEvent: {
              method: "REQUEST" as const,
              filename: mail.icsFileName,
              content: mail.ics,
            },
          }
        : {}),
    });
  };
}
