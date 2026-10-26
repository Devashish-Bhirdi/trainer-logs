// Shared by the React preview and the /api/send-trainer-schedule handler,
// so the preview is always identical to the email that gets sent.

// Change these later when the real link is ready
export const TRAINER_LOGS_LINK = 'https://gryphonacademy.co.in/closure/';
export const TRAINER_LOGS_LINK_TEXT = 'Trainer Logs';

export const escapeHtml = (value) =>
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
  table: 'border-collapse:collapse;width:100%;font-size:12px;',
  th: 'background:#1e3a8a;color:#ffffff;text-align:left;padding:8px;font-weight:600;',
  td: 'padding:8px;border-bottom:1px solid #e5e7eb;',
  kvLabel: 'padding:6px 0;vertical-align:top;color:#6b7280;width:36%;',
  kvValue: 'padding:6px 0;vertical-align:top;font-weight:600;',
  link: 'color:#1e3a8a;font-weight:600;text-decoration:underline;',
};

/* ---------- Content blocks ---------- */

// The text of item 1 is only a fallback: when the trainer has confirmed topics,
// buildTopics() renders them instead.
const EXPECTATIONS = [
  ['Topics to be covered', 'Please confirm the topics for this program.'],
  [
    'Training materials',
    'We encourage you to create engaging and interactive training materials, including presentations, handouts, case studies, and exercises. These materials should effectively convey the key concepts and ensure active participation from the attendees.',
  ],
  [
    'Training methodology',
    'We believe in a blended learning approach, incorporating various training techniques such as lectures, discussions, group activities, and multimedia resources. Please ensure the training methodology aligns with the desired learning outcomes.',
  ],
  [
    'Evaluation and feedback',
    "At the end of the program, we expect you to conduct assessments or evaluations to gauge the participants' understanding and measure the effectiveness of the training. Feedback from participants will also be collected to help us continuously improve our training initiatives.",
  ],
  [
    'Reporting',
    'As a freelancer trainer, we request you to provide periodic progress reports highlighting the topics covered, feedback received,  Attendance, and any adjustments made to the training program. This will enable us to stay updated and ensure a smooth collaboration throughout the assignment.',
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

// topics: [{ topic, module, lessons: [string] }]
// Rendered grouped by topic, then module, then lessons.
function buildTopics(topics) {
  if (!Array.isArray(topics) || topics.length === 0) {
    return `<p style="${S.p}">Please confirm the topics for this program.</p>`;
  }

  const byTopic = new Map();
  topics.forEach((t) => {
    if (!byTopic.has(t.topic)) byTopic.set(t.topic, []);
    byTopic.get(t.topic).push(t);
  });

  const items = [...byTopic.entries()]
    .map(([topic, modules]) => {
      const moduleItems = modules
        .map(
          (m) => `
          <li style="margin:0 0 4px;">
            ${escapeHtml(m.module)}
            <ul style="margin:2px 0 0;padding-left:18px;">
              ${(Array.isArray(m.lessons) ? m.lessons : [])
                .map((l) => `<li>${escapeHtml(l)}</li>`)
                .join('')}
            </ul>
          </li>`
        )
        .join('');

      return `
      <li style="margin:0 0 8px;">
        <strong>${escapeHtml(topic)}</strong>
        <ul style="margin:4px 0 0;padding-left:18px;">${moduleItems}</ul>
      </li>`;
    })
    .join('');

  return `<ul style="margin:0 0 10px;padding-left:18px;">${items}</ul>`;
}

export function buildScheduleHtml(trainer, college, paymentDays) {
  const rows = Array.isArray(trainer.rows) ? trainer.rows : [];
  const summary = Array.isArray(trainer.summary) ? trainer.summary : [];
  const year = new Date().getFullYear();

  const details = buildKeyValue([
    ['College', college.name],
    ['Address', college.address],
    ['Project Code', college.code],
    ['Trainer', trainer.name],
    ['Domain', trainer.domain],
    ['Cost / hour', trainer.costPerHour],
    ['Cost / day', trainer.costPerDay],
  ]);

  const expectations = EXPECTATIONS.map(([title, text], i) => {
    const heading = `<strong>${i + 1}. ${escapeHtml(title)}.</strong>`;

    // Item 1 shows the confirmed topics instead of the placeholder sentence
    if (i === 0) {
      return `<p style="${S.p}">${heading}</p>${buildTopics(trainer.topics)}`;
    }

    return `<p style="${S.p}">${heading} ${escapeHtml(text)}</p>`;
  }).join('');

  const notes = NOTES.map((n) => `<li>${escapeHtml(n)}</li>`).join('');

  return `
    <div style="${S.wrap}">
      <div style="${S.note}">
        Please talk about Gryphon when you start the session and incorporate the 1st and last slides in your PPT.
      </div>

      <p style="${S.p}">Dear Sir,</p>
      <p style="${S.p}">I hope this email finds you well. I am writing to provide you with details of an upcoming assignment with Gryphon Academy.</p>
      <p style="${S.p}">The assignment involves conducting a comprehensive training program on <strong>Interview Preparedness</strong>. The program aims to enhance the skills and knowledge of our Students in this area and enable them to perform effectively in the Placement season ${year}.</p>

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
        <p style="${S.label}">Trainer Logs</p>
        <p style="margin:0;">
          Please fill the logs of each session on our platform:
          <a href="${escapeHtml(TRAINER_LOGS_LINK)}" style="${S.link}">${escapeHtml(TRAINER_LOGS_LINK_TEXT)}</a>
          for the project code <strong>${escapeHtml(college.code)}</strong>.
        </p>
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