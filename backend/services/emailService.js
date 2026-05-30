'use strict';

// Email delivery via nodemailer.
//
// Configure via environment variables:
//   SMTP_HOST     — e.g. smtp.gmail.com  (required for real delivery)
//   SMTP_PORT     — default 587
//   SMTP_USER     — SMTP username / email address
//   SMTP_PASS     — SMTP password or app-specific password
//   SMTP_FROM     — From address, defaults to SMTP_USER
//
// When SMTP_HOST is not set the service falls back to logging the OTP
// to the console (dev mode) so you can still test without a real SMTP account.

const nodemailer = require('nodemailer');

function createTransport() {
  if (!process.env.SMTP_HOST) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const transport = createTransport();

async function sendOtp(email, code) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@devlabs.app';

  if (!transport) {
    // Dev fallback — log to console
    console.log(`[email] OTP for ${email}: ${code}  (SMTP not configured — set SMTP_HOST to enable real delivery)`);
    return;
  }

  await transport.sendMail({
    from,
    to: email,
    subject: 'Your Devlabs login code',
    text: `Your one-time login code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#111">Your Devlabs login code</h2>
        <p style="font-size:15px;color:#444">Use the code below to sign in. It expires in <strong>10 minutes</strong>.</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#111;padding:24px 0">${code}</div>
        <p style="font-size:13px;color:#888">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendOtp };
