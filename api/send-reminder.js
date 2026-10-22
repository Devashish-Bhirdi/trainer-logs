// api/send-reminder.js

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Gryphon Academy <reminders@gryphonacademy.co.in>';

export async function sendRemindersCore({ trainers, subject, customMessage, portalUrl }) {
  if (!Array.isArray(trainers) || trainers.length === 0) {
    throw new Error('No trainers provided for sending reminders.');
  }

  const validTrainers = trainers.filter(t => t && t.email && t.email.includes('@'));
  if (validTrainers.length === 0) {
    throw new Error('None of the selected trainers have a valid email address.');
  }

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });

  const emailSubject = subject || `Training Log Reminder – ${dateStr}`;
  const actionUrl = portalUrl || 'https://gryphonacademy.co.in';

  // Prepare batch items
  const batchEmails = validTrainers.map(trainer => {
    const trainerName = trainer.name || 'Trainer';
    const html = buildReminderHtml({
      trainerName,
      dateStr,
      customMessage,
      portalUrl: actionUrl
    });
    const text = buildReminderText({
      trainerName,
      dateStr,
      customMessage,
      portalUrl: actionUrl
    });

    return {
      from: FROM_EMAIL,
      to: [trainer.email.trim()],
      subject: emailSubject,
      html,
      text
    };
  });

  // Resend batch endpoint allows up to 100 emails per request
  const CHUNK_SIZE = 100;
  const results = [];

  for (let i = 0; i < batchEmails.length; i += CHUNK_SIZE) {
    const chunk = batchEmails.slice(i, i + CHUNK_SIZE);
    const response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chunk)
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg = data?.message || data?.error || 'Failed to send batch emails via Resend';
      throw new Error(errMsg);
    }
    results.push(data);
  }

  return {
    success: true,
    count: validTrainers.length,
    trainers: validTrainers.map(t => ({ name: t.name, email: t.email }))
  };
}

export function buildReminderHtml({ trainerName, dateStr, customMessage, portalUrl }) {
  const customMessageHtml = customMessage ? `
    <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #92400e; font-size: 14px; font-weight: 600;">Note from Admin:</p>
      <p style="margin: 6px 0 0 0; color: #78350f; font-size: 14px; white-space: pre-wrap;">${escapeHtml(customMessage)}</p>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Log Reminder</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); border: 1px solid #e5e7eb;">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a8a 0%, #312e81 100%); padding: 24px 30px; text-align: left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width: 44px; vertical-align: middle;">
                    <img src="https://res.cloudinary.com/dcjmaapvi/image/upload/v1730120218/Gryphon_Academy_Bird_Logo_yzzl3q.png" alt="Gryphon Academy" width="38" height="38" style="display: block; border-radius: 50%;" />
                  </td>
                  <td style="padding-left: 12px; vertical-align: middle;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; letter-spacing: -0.025em;">Gryphon Academy</h1>
                    <p style="margin: 2px 0 0 0; color: #93c5fd; font-size: 12px; font-weight: 500;">Trainer Management System</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px 30px;">
              <h2 style="margin: 0 0 16px 0; color: #111827; font-size: 20px; font-weight: 700;">Daily Training Log Reminder</h2>
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 15px; line-height: 1.6;">
                Dear <strong>${escapeHtml(trainerName)}</strong>,
              </p>
              <p style="margin: 0 0 16px 0; color: #374151; font-size: 15px; line-height: 1.6;">
                This is a friendly reminder to submit your training log entries for today, <strong style="color: #1e40af;">${escapeHtml(dateStr)}</strong>.
              </p>
              <p style="margin: 0 0 16px 0; color: #4b5563; font-size: 14px; line-height: 1.6;">
                Timely and accurate log submissions ensure smooth tracking of batch progression, curriculum coverage, and attendance reporting.
              </p>

              ${customMessageHtml}

              <!-- Action Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="center" style="border-radius: 8px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);">
                    <a href="${escapeHtml(portalUrl)}" target="_blank" style="display: inline-block; padding: 12px 24px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                      Open Trainer Portal &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-top: 20px;">
                <p style="margin: 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                  <em>If you have already submitted your logs for today, please disregard this email.</em>
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 20px 30px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0 0 6px 0; color: #6b7280; font-size: 12px; font-weight: 500;">
                &copy; ${new Date().getFullYear()} Gryphon Academy. All rights reserved.
              </p>
              <p style="margin: 0; color: #9ca3af; font-size: 11px;">
                This is an automated reminder sent from Gryphon Academy Trainer Management System.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export function buildReminderText({ trainerName, dateStr, customMessage, portalUrl }) {
  return `
Dear ${trainerName},

This is a friendly reminder to please fill in your training log entries for today, ${dateStr}.

Timely and accurate log submissions help us track training progress effectively. Kindly ensure your entries are completed at the earliest.
${customMessage ? `\nNote from Admin:\n${customMessage}\n` : ''}
Trainer Portal: ${portalUrl}

If you have already submitted your entries, please disregard this message.

Thank you for your cooperation.

Best regards,
Gryphon Academy Admin Team
  `.trim();
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const result = await sendRemindersCore(req.body || {});
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in send-reminder API:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
