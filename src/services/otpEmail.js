/**
 * OTP email rendering and delivery.
 *
 * Kept separate from otpService so the code generator has no opinion about
 * transport, and separate from emailService so the TallyFin branding lives in
 * one place.
 *
 * Deliberately plain HTML with inline styles and a large plaintext fallback:
 * a verification code needs to survive Gmail's clipping, Outlook's renderer and
 * a text-only client. A code the user cannot read is a support call.
 */
import emailService from './emailService.js';
import { OTP_PURPOSES } from './otpService.js';
import logger from '../utils/logger.js';

const BRAND = {
  name: 'TallyFin',
  tagline: 'Har Hisaab Aasan Hai',
  navy: '#032B6B',
  green: '#13A538',
};

const COPY = {
  [OTP_PURPOSES.EMAIL_VERIFICATION]: {
    subject: (code) => `${code} is your ${BRAND.name} verification code`,
    heading: 'Verify your email',
    intro: 'Use this code to finish setting up your TallyFin account.',
  },
  [OTP_PURPOSES.PASSWORD_RESET]: {
    subject: (code) => `${code} is your ${BRAND.name} password reset code`,
    heading: 'Reset your password',
    intro: 'Use this code to set a new password for your TallyFin account.',
  },
};

function renderHtml({ heading, intro, code, expiresInMinutes, name }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F5F7FB;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FB;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${BRAND.navy};padding:20px 24px;">
            <div style="color:#FFFFFF;font-size:20px;font-weight:bold;">${BRAND.name}</div>
            <div style="color:#9FE7B4;font-size:11px;letter-spacing:0.6px;margin-top:2px;">${BRAND.tagline}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px 8px;">
            <div style="font-size:18px;font-weight:bold;color:${BRAND.navy};">${heading}</div>
            <div style="font-size:14px;line-height:21px;color:#6B7280;margin-top:8px;">
              ${name ? `Hi ${name},<br/>` : ''}${intro}
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 24px;">
            <div style="display:inline-block;background:#F5F7FB;border:1px solid #ECEFF4;border-radius:10px;padding:16px 28px;">
              <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:${BRAND.navy};">${code}</span>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 24px 24px;">
            <div style="font-size:13px;line-height:20px;color:#6B7280;">
              This code expires in <strong>${expiresInMinutes} minutes</strong> and can only be used once.
            </div>
            <div style="font-size:13px;line-height:20px;color:#6B7280;margin-top:12px;">
              If you didn't request this, you can safely ignore this email — no changes have been made to your account.
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#F5F7FB;padding:14px 24px;">
            <div style="font-size:11px;color:#9AA6B6;">
              TallyFin never asks for this code by phone, WhatsApp or email. Don't share it with anyone.
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderText({ heading, intro, code, expiresInMinutes }) {
  return [
    `${BRAND.name} — ${heading}`,
    '',
    intro,
    '',
    `Your code: ${code}`,
    '',
    `This code expires in ${expiresInMinutes} minutes and can only be used once.`,
    `If you didn't request this, you can ignore this email.`,
    '',
    `TallyFin never asks for this code by phone, WhatsApp or email.`,
  ].join('\n');
}

/**
 * Send an OTP. Returns `{ success }` — callers must NOT surface the difference
 * between "sent" and "no such account" to the user.
 */
export async function sendOtpEmail({ to, name, code, purpose, expiresInMinutes }) {
  const copy = COPY[purpose];
  if (!copy) throw new Error(`Unknown OTP purpose: ${purpose}`);

  const view = { ...copy, code, expiresInMinutes, name };

  const result = await emailService.sendEmail({
    to,
    subject: copy.subject(code),
    html: renderHtml(view),
    text: renderText(view),
    // Verification codes expire in minutes — they must not sit behind a queue
    // of invoice reminders.
    priority: 'high',
    trackDelivery: false,
  });

  if (!result?.success) {
    logger.error(`OTP email to ${to} failed: ${result?.message || 'unknown error'}`);
  }
  return result;
}

export default { sendOtpEmail };
