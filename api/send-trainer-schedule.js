const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'Gryphon Academy <devashish.bhirdi@gmail.com>';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function buildScheduleHtml(trainer) {
  const rows = trainer.rows.map((r) => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.batch)}</td>
      <td>${escapeHtml(r.time)}</td>
      <td>${escapeHtml(r.hours)}</td>
      <td>${escapeHtml(r.foodLodging)}</td>
      <td>${escapeHtml(r.travel)}</td>
      <td>${escapeHtml(r.totalAmount)}</td>
      <td>${escapeHtml(r.particular)}</td>
      <td>${escapeHtml(r.total)}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#1f2937">
      <h2>Trainer Schedule Details</h2>

      <p><strong>Trainer Name:</strong>
        ${escapeHtml(trainer.name)}</p>
      <p><strong>Domain:</strong>
        ${escapeHtml(trainer.domain)}</p>
      <p><strong>Cost/hour:</strong>
        ${escapeHtml(trainer.costPerHour)}</p>
      <p><strong>Cost/day:</strong>
        ${escapeHtml(trainer.costPerDay)}</p>

      <table cellpadding="8" cellspacing="0" border="1"
        style="border-collapse:collapse;width:100%;
        font-size:12px;border-color:#d1d5db">
        <thead style="background:#1e3a8a;color:white">
          <tr>
            <th>Date</th>
            <th>Batch</th>
            <th>Time</th>
            <th>Hour</th>
            <th>Food + Lodging/Day</th>
            <th>Travel To &amp; Fro</th>
            <th>Total Amount</th>
            <th>Particular</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="margin-top:24px">
        Regards,<br/>Gryphon Academy Admin Team
      </p>
    </div>
  `;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  if (!RESEND_API_KEY) {
    return res.status(500).json({
      error: 'RESEND_API_KEY is not configured.',
    });
  }

  const trainers = req.body?.trainers;

  if (!Array.isArray(trainers) || trainers.length === 0) {
    return res.status(400).json({
      error: 'No trainers provided.',
    });
  }

  const invalid = trainers.find(
    (t) =>
      !t?.name ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email || '') ||
      !Array.isArray(t.rows) ||
      t.rows.length === 0
  );

  if (invalid) {
    return res.status(400).json({
      error: 'Each trainer must have a valid email and schedule rows.',
    });
  }

  try {
    const results = [];

    // Resend batch endpoint supports up to 100 emails per request.
    for (let i = 0; i < trainers.length; i += 100) {
      const chunk = trainers.slice(i, i + 100);

      const response = await fetch(
        'https://api.resend.com/emails/batch',
        {
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
              html: buildScheduleHtml(trainer),
            }))
          ),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.message ||
          data?.error ||
          'Failed to send schedule emails.'
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