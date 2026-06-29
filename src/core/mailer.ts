import { env } from '../config/env.js';

/**
 * Minimal email sender backed by Resend's HTTP API (no SDK dependency — Node 20+
 * has global fetch). When RESEND_API_KEY is unset (dev), we log the message
 * instead of sending, so flows are testable without credentials and never fail
 * silently.
 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(msg: MailMessage): Promise<void> {
  if (!env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.info(`[mailer] (no RESEND_API_KEY) would send to ${msg.to}: ${msg.subject}\n${msg.text ?? msg.html}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend send failed (${res.status}): ${detail}`);
  }
}

/** Build the password-reset email (link carries the opaque token). */
export function passwordResetEmail(to: string, resetUrl: string): MailMessage {
  return {
    to,
    subject: 'Réinitialisation de votre mot de passe Tarteel',
    text:
      `Vous avez demandé à réinitialiser votre mot de passe.\n\n` +
      `Ouvrez ce lien pour choisir un nouveau mot de passe :\n${resetUrl}\n\n` +
      `Ce lien expire dans ${env.PASSWORD_RESET_TTL_MINUTES} minutes. ` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
    html:
      `<p>Vous avez demandé à réinitialiser votre mot de passe.</p>` +
      `<p><a href="${resetUrl}">Choisir un nouveau mot de passe</a></p>` +
      `<p>Ce lien expire dans ${env.PASSWORD_RESET_TTL_MINUTES} minutes. ` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
  };
}
