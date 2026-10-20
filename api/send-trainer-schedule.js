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

function buildScheduleTable(rows) {
  if (!rows.length) return '';

  const body = rows
    .map(
      (r) => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.batch)}</td>
      <td>${escapeHtml(r.time)}</td>
      <td>${escapeHtml(r.hours)}</td>
      <td>${escapeHtml(r.foodLodging)}</td>
      <td>${escapeHtml(r.travel)}</td>
      <td>${escapeHtml(r.totalAmount)}</td>
    </tr>
  `
    )
    .join('');

  return `
    <h3 style="margin:24px 0 8px">Schedule</h3>
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
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function buildSummaryTable(summary) {
  if (!summary.length) return '';

  const body = summary
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.particular)}</td>
      <td>${escapeHtml(s.total)}</td>
    </tr>
  `
    )
    .join('');

  return `
    <h3 style="margin:24px 0 8px">Summary</h3>
    <table cellpadding="8" cellspacing="0" border="1"
      style="border-collapse:collapse;width:100%;
      font-size:12px;border-color:#d1d5db">
      <thead style="background:#1e3a8a;color:white">
        <tr>
          <th style="text-align:left">Particular</th>
          <th style="text-align:left">Total</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function buildScheduleHtml(trainer, college, paymentDays) {
  const rows = Array.isArray(trainer.rows) ? trainer.rows : [];
  const summary = Array.isArray(trainer.summary) ? trainer.summary : [];

  const year = new Date().getFullYear();
  const paymentCycle = `${paymentDays} days from the date of invoice`;

  return `
    <div style="font-family:Arial,sans-serif;color:#1f2937">
      <h5>Please talk about Gryphon when you start the session and incorporate the 1st and last in your PPT</h5>

      <p>Dear Sir,<br/>
      I hope this email finds you well. I am writing to provide you with the details of an upcoming assignment with Gryphon Academy</p>

      <p>The assignment involves conducting a comprehensive training program on Interview Preparedness. The program aims to enhance the skills and knowledge of our Students in this area and enable them to perform effectively in the Placement season ${year}</p>
      <p>Please find below the details:</p>
      <p><strong>1. College Name:</strong> ${escapeHtml(college.name)}</p>
      <p><strong>2. Venue:</strong> ${escapeHtml(college.venue)}</p>
      <p><strong>3. Trainer Name:</strong>
        ${escapeHtml(trainer.name)}</p>
      <p><strong>4. Domain:</strong>
        ${escapeHtml(trainer.domain)}</p>
      <p><strong>5. Cost/hour:</strong>
        ${escapeHtml(trainer.costPerHour)}</p>
      <p><strong>6. Cost/day:</strong>
        ${escapeHtml(trainer.costPerDay)}</p>
      <p><strong>7. Details of Schedule</strong></p>
      ${buildScheduleTable(rows)}
      <p><strong>8. Topics to be covered - Please confirm the same</strong></p>
      <p><strong>9. Training Materials: We encourage you to create engaging and interactive training materials, including presentations, handouts, case studies, and exercises. These materials should effectively convey the key concepts and ensure active participation from the attendees.</strong></p>
      <p><strong>10. Training Methodology: We believe in a blended learning approach, incorporating various training techniques such as lectures, discussions, group activities, and multimedia resources. Please ensure the training methodology aligns with the desired learning outcomes.</strong></p>
      <p><strong>11. Evaluation and Feedback: At the end of the program, we expect you to conduct assessments or evaluations to gauge the participants' understanding and measure the effectiveness of the training. Feedback from participants will also be collected to help us continuously improve our training initiatives.</strong></p>
      <p><strong> Reporting: As a freelancer trainer, we request you to provide periodic progress reports highlighting the topics covered, feedback received, Attendance, and any adjustments made to the training program. This will enable us to stay updated and ensure a smooth collaboration throughout the assignment.</strong></p>
      <p><strong>12. Please go through the SOP and find some important points: PPT template, Evaluation Report, and invoice template need to be followed.</strong></p>
      <p><strong>Evaluations are important before raising the invoice.</strong></p>
      <p><strong>We would like to ask you to please confirm that you received this email and your commitment to the assignment. We look forward to working together and delivering an exceptional training experience.</strong></p>
      <p><strong>13. Trainer would be abiding by the below payment cycle: ${escapeHtml(paymentCycle)}</strong></p>
      ${buildSummaryTable(summary)}

      <p><strong>Please maintain the evaluation sheet/assessment sheet</strong></p>
      <p><strong>*Note-</strong></p>
      <p style="margin-left:12px">1. The trainer is requested to complete the total hours as per the contract</p>
      <p style="margin-left:12px">2. Please maintain the evaluation sheet/assessment sheet.</p>
      <p style="margin-left:12px">3. Use the PPT template given by Gryphon Academy.</p>
      <p style="margin-top:24px">
        Regards,
      </p>
    </div>
  `;
}

const hasContent = (t) =>
  (Array.isArray(t.rows) && t.rows.length > 0) ||
  (Array.isArray(t.summary) && t.summary.length > 0);

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

  const { trainers, college, paymentDays } = req.body || {};

  if (!Array.isArray(trainers) || trainers.length === 0) {
    return res.status(400).json({
      error: 'No trainers provided.',
    });
  }

  const collegeName = String(college?.name ?? '').trim();
  const collegeVenue = String(college?.venue ?? '').trim();

  if (!collegeName || !collegeVenue) {
    return res.status(400).json({
      error: 'College name and venue are required.',
    });
  }

  const days = Number(paymentDays);

  if (!Number.isInteger(days) || days <= 0) {
    return res.status(400).json({
      error: 'Payment cycle must be a whole number of days.',
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

  const collegeInfo = { name: collegeName, venue: collegeVenue };

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
            html: buildScheduleHtml(trainer, collegeInfo, days),
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