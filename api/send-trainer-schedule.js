const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ||
  'Gryphon Academy <reminders@gryphonacademy.co.in>';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/* ---------- Inline styles (email clients ignore most CSS classes) ---------- */

const S = {
  wrap: 'font-family:Arial,sans-serif;color:#1f2937;font-size:14px;line-height:1.55;margin:0;text-align:left;',
  p: 'margin:0 0 10px;',
  box: 'background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 16px;',
  label:
    'margin:0 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#1e3a8a;font-weight:700;',
  note: 'background:#fffbeb;border-left:4px solid #f59e0b;padding:10px 14px;border-radius:4px;margin:0 0 16px;',
  table:
    'border-collapse:collapse;width:100%;font-size:12px;',
  th: 'background:#1e3a8a;color:#ffffff;text-align:left;padding:8px;font-weight:600;',
  td: 'padding:8px;border-bottom:1px solid #e5e7eb;',
  kvLabel: 'padding:6px 0;vertical-align:top;color:#6b7280;width:36%;',
  kvValue: 'padding:6px 0;vertical-align:top;font-weight:600;',
};

/* ---------- Content blocks ---------- */

const EXPECTATIONS = [
  ['Topics to be covered', 'Please confirm the topics for this program.'],
  [
    'Training materials',
    'Create engaging, interactive materials such as presentations, handouts, case studies and exercises that encourage active participation from the attendees.',
  ],
  [
    'Training methodology',
    'We follow a blended learning approach: lectures, discussions, group activities and multimedia resources. Please align the methodology with the desired learning outcomes.',
  ],
  [
    'Evaluation and feedback',
    "Conduct assessments at the end of the program to gauge the participants' understanding and the effectiveness of the training. Participant feedback will also be collected.",
  ],
  [
    'Reporting',
    'As a freelance trainer, please share periodic progress reports covering topics covered, feedback received, attendance and any adjustments made to the program.',
  ],
  [
    'SOP',
    'Please follow the SOP: the PPT template, Evaluation Report and invoice template. Evaluations must be completed before raising the invoice.',
  ],
];

const NOTES = [
  'Complete the total hours as per the contract.',
  'Maintain the evaluation / assessment sheet.',
  'Use the PPT template provided by Gryphon Academy.',
];

function buildKeyValue(pairs) {
  const body = pairs
    .map(
      ([k, v]) => `
      <tr>
        <td style="${S.kvLabel}">${escapeHtml(k)}</td>
        <td style="${S.kvValue}">${escapeHtml(v)}</td>
      </tr>`
    )
    .join('');

  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">${body}</table>`;
}

function buildScheduleTable(rows) {
  if (!rows.length) return '';

  const headers = [
    'Date',
    'Batch',
    'Time',
    'Hours',
    'Food + Lodging/Day',
    'Travel To & Fro',
    'Total Amount',
  ];

  const head = headers
    .map((h) => `<th style="${S.th}">${escapeHtml(h)}</th>`)
    .join('');

  const body = rows
    .map(
      (r) => `
      <tr>
        <td style="${S.td}">${escapeHtml(r.date)}</td>
        <td style="${S.td}">${escapeHtml(r.batch)}</td>
        <td style="${S.td}">${escapeHtml(r.time)}</td>
        <td style="${S.td}">${escapeHtml(r.hours)}</td>
        <td style="${S.td}">${escapeHtml(r.foodLodging)}</td>
        <td style="${S.td}">${escapeHtml(r.travel)}</td>
        <td style="${S.td}">${escapeHtml(r.totalAmount)}</td>
      </tr>`
    )
    .join('');

  return `
    <p style="${S.label}">Schedule</p>
    <table cellpadding="0" cellspacing="0" border="0" style="${S.table}">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function buildSummaryTable(summary) {
  if (!summary.length) return '';

  const body = summary
    .map(
      (s) => `
      <tr>
        <td style="${S.td}">${escapeHtml(s.particular)}</td>
        <td style="${S.td}">${escapeHtml(s.total)}</td>
      </tr>`
    )
    .join('');

  return `
    <p style="${S.label}margin-top:18px;">Summary</p>
    <table cellpadding="0" cellspacing="0" border="0" style="${S.table}">
      <thead>
        <tr>
          <th style="${S.th}">Particular</th>
          <th style="${S.th}">Total</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function buildScheduleHtml(trainer, college, paymentDays) {
  const rows = Array.isArray(trainer.rows) ? trainer.rows : [];
  const summary = Array.isArray(trainer.summary) ? trainer.summary : [];
  const year = new Date().getFullYear();

  const details = buildKeyValue([
    ['College', college.name],
    ['Address', college.address],
    ['Trainer', trainer.name],
    ['Domain', trainer.domain],
    ['Cost / hour', trainer.costPerHour],
    ['Cost / day', trainer.costPerDay],
  ]);

  const expectations = EXPECTATIONS.map(
    ([title, text], i) =>
      `<p style="${S.p}"><strong>${i + 1}. ${escapeHtml(title)}.</strong> ${escapeHtml(text)}</p>`
  ).join('');

  const notes = NOTES.map((n) => `<li>${escapeHtml(n)}</li>`).join('');

  return `
    <div style="${S.wrap}">
      <div style="${S.note}">
        Please talk about Gryphon when you start the session, and include the first and last slides of our PPT.
      </div>

      <p style="${S.p}">Dear Sir,</p>
      <p style="${S.p}">I hope this email finds you well. I am writing with the details of an upcoming assignment with Gryphon Academy: a training program on <strong>Interview Preparedness</strong>, to help our students perform well in the Placement season ${year}.</p>

      <div style="${S.box}">
        <p style="${S.label}">Assignment details</p>
        ${details}
      </div>

      <div style="${S.box}">
        <p style="${S.label}">Schedule &amp; summary</p>
        ${buildScheduleTable(rows)}
        ${buildSummaryTable(summary)}
      </div>

      <div style="${S.box}">
        <p style="${S.label}">What we expect</p>
        ${expectations}
      </div>

      <div style="${S.box}">
        <p style="${S.label}">Payment</p>
        <p style="margin:0;">Payment cycle: <strong>${escapeHtml(paymentDays)} days</strong> from the date of invoice.</p>
      </div>

      <div style="${S.box}">
        <p style="${S.label}">Please note</p>
        <ul style="margin:0;padding-left:18px;">${notes}</ul>
      </div>

      <p style="${S.p}">Kindly confirm receipt of this email and your commitment to the assignment. We look forward to working with you.</p>
      <p style="margin:0;">Regards,<br/>Gryphon Academy</p>
    </div>
  `;
}

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

  if (!collegeName || !collegeAddress) {
    return res.status(400).json({
      error: 'College name and address are required.',
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

  const collegeInfo = { name: collegeName, address: collegeAddress };

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