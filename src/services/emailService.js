// src/services/emailService.js

/**
 * Sends reminder emails to trainers via Resend backend API
 * @param {Object} options
 * @param {Array<{name: string, email: string}>} options.trainers
 * @param {string} [options.subject]
 * @param {string} [options.customMessage]
 * @returns {Promise<{success: boolean, count: number, trainers: Array}>}
 */
export async function sendTrainerRemindersViaResend({ trainers, subject, customMessage }) {
  if (!trainers || trainers.length === 0) {
    throw new Error('Please select at least one trainer.');
  }

  const portalUrl = window.location.origin + (import.meta.env.BASE_URL || '/');

  // Try the base-prefixed path first, fall back to /api/send-reminder
  const base = import.meta.env.BASE_URL || '/';
  const endpoints = [
    `${base.replace(/\/$/, '')}/api/send-reminder`,
    '/api/send-reminder'
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          trainers,
          subject,
          customMessage,
          portalUrl
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || data.message || `Server responded with status ${response.status}`);
      }

      return data;
    } catch (err) {
      lastError = err;
      // If endpoint returned 404, continue to next fallback endpoint
      if (err.message && err.message.includes('404')) {
        continue;
      }
      // For other errors (validation, resend error), throw directly
      throw err;
    }
  }

  throw lastError || new Error('Failed to reach email reminder service.');
}

/**
 * Fallback: Opens Outlook / default mail client with mailto:
 * @param {Object} options
 * @param {Array<{name: string, email: string}>} options.trainers
 * @param {string} [options.subject]
 * @param {string} [options.message]
 */
export function openOutlookMailto({ trainers, subject, message }) {
  const bccEmails = trainers.map(t => t.email).filter(Boolean).join(';');
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const emailSubject = encodeURIComponent(subject || `Training Log Reminder – ${dateStr}`);
  const emailBody = encodeURIComponent(
    message ||
`Dear Trainer,

This is a friendly reminder to please fill in your training log entries for today, ${dateStr}.

Timely and accurate log submissions help us track training progress effectively. Kindly ensure your entries are completed at the earliest.

If you have already submitted your entries, please disregard this message.

Thank you for your cooperation.

Best regards,
Gryphon Academy Admin Team`
  );

  window.location.href = `mailto:?bcc=${bccEmails}&subject=${emailSubject}&body=${emailBody}`;
}
