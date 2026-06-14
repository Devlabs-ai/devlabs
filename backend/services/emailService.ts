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

function createTransport(): ReturnType<typeof nodemailer.createTransport> | null {
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

async function sendOtp(email: string, code: string): Promise<void> {
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

interface SalesLeadOpts {
  companyName: string;
  email: string;
  domain: string;
  teamSize: string;
  plan: string;
  message?: string;
}

async function sendSalesLead({ companyName, email, domain, teamSize, plan, message }: SalesLeadOpts): Promise<void> {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@devlabs.app';
  const to = process.env.SALES_INBOX || process.env.SMTP_USER || 'sales@devlabs.app';

  const planLabel: Record<string, string> = {
    starter: 'Starter',
    pro: 'Pro',
    enterprise: 'Enterprise',
    unsure: 'Not sure yet',
  };

  const planLabelStr = planLabel[plan] || plan;

  const text = [
    'New Devlabs sales inquiry',
    '',
    `Company: ${companyName}`,
    `Email: ${email}`,
    `Domain: ${domain}`,
    `Team size: ${teamSize}`,
    `Plan interest: ${planLabelStr}`,
    '',
    message ? `Message:\n${message}` : 'Message: (none)',
  ].join('\n');

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#111">New Devlabs sales inquiry</h2>
      <table style="font-size:14px;color:#333;border-collapse:collapse;width:100%">
        <tr><td style="padding:6px 12px 6px 0;font-weight:600">Company</td><td>${companyName}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;font-weight:600">Email</td><td>${email}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;font-weight:600">Domain</td><td>${domain}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;font-weight:600">Team size</td><td>${teamSize}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;font-weight:600">Plan</td><td>${planLabelStr}</td></tr>
      </table>
      ${message ? `<p style="font-size:14px;color:#444;margin-top:20px"><strong>Message</strong><br/>${message.replace(/\n/g, '<br/>')}</p>` : ''}
    </div>
  `;

  if (!transport) {
    console.log(`[email] Sales inquiry from ${email} (${companyName})`);
    console.log(text);
    return;
  }

  await transport.sendMail({
    from,
    to,
    replyTo: email,
    subject: `[Devlabs] Sales inquiry — ${companyName}`,
    text,
    html,
  });
}

module.exports = { sendOtp, sendSalesLead };
