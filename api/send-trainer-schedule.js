import { buildScheduleHtml } from '../src/utils/trainerEmailTemplate.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'Gryphon Academy <reminders@gryphonacademy.co.in>';

const hasContent = (t) =>
  (Array.isArray(t.rows) && t.rows.length > 0) ||
  (Array.isArray(t.summary) && t.summary.length > 0);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'RESEND_API_KEY is not configured.' });
  }

  const { trainers, college } = req.body || {};

  if (!Array.isArray(trainers) || trainers.length === 0) {
    return res.status(400).json({ error: 'No trainers provided.' });
  }

  const collegeName = String(college?.name ?? '').trim();
  const collegeAddress = String(college?.address ?? '').trim();
  const projectCode = String(college?.code ?? '').trim();

  if (!collegeName || !collegeAddress) {
    return res.status(400).json({
      error: 'College name and address are required.',
    });
  }

  if (!projectCode) {
    return res.status(400).json({
      error: 'Project code is required.',
    });
  }

  const badDays = trainers.find((t) => {
    const days = Number(t?.paymentDays);
    return !Number.isInteger(days) || days <= 0;
  });

  if (badDays) {
    return res.status(400).json({
      error: `Payment cycle must be a whole number of days for ${
        badDays?.name || 'each trainer'
      }.`,
    });
  }

  const invalid = trainers.find(
    (t) =>
      !t?.name ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email || '') ||
      !hasContent(t)
  );

  if (invalid) {
    return res.status(400).json({
      error:
        'Each trainer must have a valid email and at least one schedule or summary row.',
    });
  }

  const collegeInfo = {
    name: collegeName,
    address: collegeAddress,
    code: projectCode,
  };

  try {
    const results = [];

    // Resend batch endpoint supports up to 100 emails per request.
    for (let i = 0; i < trainers.length; i += 100) {
      const chunk = trainers.slice(i, i + 100);

      const response = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          chunk.map((trainer) => ({
            from: FROM_EMAIL,
            to: [trainer.email],
            subject: 'Trainer Schedule Details',
            html: buildScheduleHtml(
              trainer,
              collegeInfo,
              Number(trainer.paymentDays)
            ),
          }))
        ),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.message || data?.error || 'Failed to send schedule emails.'
        );
      }

      results.push(data);
    }

    return res.status(200).json({
      success: true,
      count: trainers.length,
      results,
    });
  } catch (error) {
    console.error('Trainer schedule email error:', error);

    return res.status(502).json({
      error: error.message || 'Failed to send emails.',
    });
  }
}