import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { buildScheduleHtml } from '../utils/trainerEmailTemplate';

const normalize = (value) =>
  String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const aliases = {
  domain: ['domain'],
  trainerName: ['trainername'],
  date: ['date'],
  batch: ['batch'],
  time: ['time'],
  hours: ['hours', 'hour'],
  costPerHour: ['costhrs', 'costperhour'],
  costPerDay: ['costday', 'costperday'],
  foodLodging: ['foodlodgingday', 'foodandlodgingday'],
  travel: ['traveltofro', 'traveltoandfro'],
  totalAmount: ['totalamount'],
  particular: ['particular', 'particulars'],
  total: ['total'],
};

// Labels (already normalized) that sit in one cell with the value in the
// next cell of the same row. "Project Code:" normalizes to "projectcode".
const collegeLabels = {
  name: ['collegename', 'college'],
  address: ['address', 'collegeaddress'],
  code: ['projectcode'],
};

const EMPTY_COLLEGE = { name: '', address: '', code: '' };

const COLLEGE_FIELD_LABELS = {
  name: 'College Name',
  address: 'Address',
  code: 'Project Code',
};

const SCHEDULE_FIELDS = [
  ['date', 'Date'],
  ['batch', 'Batch'],
  ['time', 'Time'],
  ['hours', 'Hours'],
  ['foodLodging', 'Food + Lodging/Day'],
  ['travel', 'Travel To & Fro'],
  ['totalAmount', 'Total Amount'],
];

/**
 * Finds "College Name" / "Address" / "Project Code" labels anywhere in the
 * sheet and returns the value from the cell immediately to the right.
 */
function extractCollege(rows) {
  const result = { ...EMPTY_COLLEGE };

  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      const label = normalize(row[i]);
      if (!label) continue;

      for (const [field, names] of Object.entries(collegeLabels)) {
        if (!result[field] && names.includes(label)) {
          const value = String(row[i + 1] ?? '').trim();
          if (value) result[field] = value;
        }
      }
    }
  }

  return result;
}

// True for a "College Name | value", "Address | value" or
// "Project Code | value" row, so it is not mistaken for trainer data.
function isCollegeRow(row) {
  return row.some((value) => {
    const label = normalize(value);
    return Object.values(collegeLabels).some((names) => names.includes(label));
  });
}

function getColumnMap(row) {
  const cells = row.map(normalize);
  const map = {};

  for (const [field, names] of Object.entries(aliases)) {
    map[field] = cells.findIndex((cell) => names.includes(cell));
  }

  // Trainer Name and the core schedule fields identify a table header.
  const required = ['trainerName', 'domain', 'date', 'batch', 'time'];

  return required.every((field) => map[field] !== -1) ? map : null;
}

function cell(row, map, field) {
  const index = map[field];
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

function isBlankRow(row) {
  return row.every((value) => String(value ?? '').trim() === '');
}

function extractTrainers(rows) {
  const grouped = new Map();
  let columns = null;
  let currentTrainer = ''; // reset on blank rows (used for schedule rows)
  let lastTrainer = ''; // survives blank rows (used for summary rows)

  const getTrainer = (name) => {
    const key = normalize(name);

    if (!grouped.has(key)) {
      grouped.set(key, {
        name,
        domain: '',
        costPerHour: '',
        costPerDay: '',
        rows: [], // schedule table
        summary: [], // particular / total table
      });
    }

    return grouped.get(key);
  };

  for (const row of rows) {
    const detectedColumns = getColumnMap(row);

    if (detectedColumns) {
      columns = detectedColumns;
      currentTrainer = '';
      lastTrainer = '';
      continue;
    }

    if (isBlankRow(row)) {
      currentTrainer = '';
      continue;
    }

    // College Name / Address / Project Code rows are sheet metadata.
    if (isCollegeRow(row)) continue;

    if (!columns) continue;

    const trainerCell = cell(row, columns, 'trainerName');

    if (trainerCell) {
      currentTrainer = trainerCell;
      lastTrainer = trainerCell;
    }

    const date = cell(row, columns, 'date');
    const batch = cell(row, columns, 'batch');
    const time = cell(row, columns, 'time');
    const particular = cell(row, columns, 'particular');
    const total = cell(row, columns, 'total');

    const hasSchedule = Boolean(date || batch || time);
    const hasSummary = Boolean(particular || total);

    // Ignore rows that contain neither schedule nor summary information.
    if (!hasSchedule && !hasSummary) continue;

    // Schedule rows need an active trainer. Summary rows may fall back to
    // the last trainer seen in this table (e.g. after a blank row).
    const owner = hasSchedule
      ? currentTrainer
      : currentTrainer || lastTrainer;

    if (!owner) continue;

    const trainer = getTrainer(owner);

    // Preserve the first available shared detail.
    for (const field of ['domain', 'costPerHour', 'costPerDay']) {
      const value = cell(row, columns, field);
      if (!trainer[field] && value) trainer[field] = value;
    }

    if (hasSchedule) {
      trainer.rows.push({
        date,
        batch,
        time,
        hours: cell(row, columns, 'hours'),
        foodLodging: cell(row, columns, 'foodLodging'),
        travel: cell(row, columns, 'travel'),
        totalAmount: cell(row, columns, 'totalAmount'),
      });
    }

    if (hasSummary) {
      trainer.summary.push({ particular, total });
    }
  }

  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const buttonClass =
  'rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50';

const cellInput = 'w-full min-w-[80px] rounded border p-1 text-xs';

/* ---------- Collapsible preview + editor for one trainer ---------- */

function TrainerPreview({
  trainer, // effective trainer (edited draft, or the parsed original)
  isEdited,
  college,
  paymentDays,
  email,
  onChange, // (updater) => void, where updater receives a cloned trainer
  onReset,
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const html = buildScheduleHtml(trainer, college, paymentDays || '___');

  const srcDoc = `<!doctype html><html><body style="margin:12px;background:#ffffff;">${html}</body></html>`;

  const setField = (field, value) =>
    onChange((t) => {
      t[field] = value;
    });

  const setRowField = (index, field, value) =>
    onChange((t) => {
      t.rows[index][field] = value;
    });

  const setSummaryField = (index, field, value) =>
    onChange((t) => {
      t.summary[index][field] = value;
    });

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block font-medium">{trainer.name}</span>
          <span className="block truncate text-xs text-gray-500">
            {email || 'No email resolved'}
            {isEdited && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                Edited
              </span>
            )}
          </span>
        </span>
        <span className="text-sm text-blue-800">
          {open ? 'Hide preview ▲' : 'Show preview ▼'}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="rounded-lg border border-blue-900 px-3 py-1.5 text-sm font-medium text-blue-900"
            >
              {editing ? 'Done editing' : 'Modify mail'}
            </button>

            {isEdited && (
              <button
                type="button"
                onClick={onReset}
                className="text-sm text-red-600"
              >
                Reset to sheet values
              </button>
            )}
          </div>

          {editing && (
            <div className="space-y-4 rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-600">
                Changes apply only to this trainer&apos;s email. College
                name, address and project code are edited in the Assignment
                details section above.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ['domain', 'Domain'],
                  ['costPerHour', 'Cost / hour'],
                  ['costPerDay', 'Cost / day'],
                ].map(([field, label]) => (
                  <label
                    key={field}
                    className="text-xs font-medium text-gray-600"
                  >
                    {label}
                    <input
                      type="text"
                      value={trainer[field] ?? ''}
                      onChange={(e) => setField(field, e.target.value)}
                      className="mt-1 w-full rounded border p-2 text-sm"
                    />
                  </label>
                ))}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-600">
                  Schedule rows
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr>
                        {SCHEDULE_FIELDS.map(([, label]) => (
                          <th
                            key={label}
                            className="px-1 pb-1 text-left font-medium text-gray-500"
                          >
                            {label}
                          </th>
                        ))}
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {trainer.rows.map((row, index) => (
                        <tr key={index}>
                          {SCHEDULE_FIELDS.map(([field, label]) => (
                            <td key={field} className="p-1">
                              <input
                                type="text"
                                aria-label={`${label} row ${index + 1}`}
                                value={row[field] ?? ''}
                                onChange={(e) =>
                                  setRowField(index, field, e.target.value)
                                }
                                className={cellInput}
                              />
                            </td>
                          ))}
                          <td className="p-1">
                            <button
                              type="button"
                              onClick={() =>
                                onChange((t) => {
                                  t.rows.splice(index, 1);
                                })
                              }
                              className="text-red-600"
                              aria-label={`Remove schedule row ${index + 1}`}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange((t) => {
                      t.rows.push(
                        Object.fromEntries(
                          SCHEDULE_FIELDS.map(([field]) => [field, ''])
                        )
                      );
                    })
                  }
                  className="mt-2 text-sm text-blue-800"
                >
                  + Add schedule row
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-gray-600">
                  Summary rows
                </p>
                <div className="space-y-2">
                  {trainer.summary.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        type="text"
                        aria-label={`Particular ${index + 1}`}
                        placeholder="Particular"
                        value={item.particular ?? ''}
                        onChange={(e) =>
                          setSummaryField(index, 'particular', e.target.value)
                        }
                        className={cellInput}
                      />
                      <input
                        type="text"
                        aria-label={`Total ${index + 1}`}
                        placeholder="Total"
                        value={item.total ?? ''}
                        onChange={(e) =>
                          setSummaryField(index, 'total', e.target.value)
                        }
                        className={cellInput}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onChange((t) => {
                            t.summary.splice(index, 1);
                          })
                        }
                        className="text-red-600"
                        aria-label={`Remove summary row ${index + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange((t) => {
                      t.summary.push({ particular: '', total: '' });
                    })
                  }
                  className="mt-2 text-sm text-blue-800"
                >
                  + Add summary row
                </button>
              </div>
            </div>
          )}

          <iframe
            title={`Email preview for ${trainer.name}`}
            srcDoc={srcDoc}
            sandbox=""
            className="h-[520px] w-full rounded-lg border bg-white"
          />
        </div>
      )}
    </div>
  );
}

/* ---------- Main component ---------- */

export default function TrainerScheduleEmail() {
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [trainers, setTrainers] = useState([]);
  const [drafts, setDrafts] = useState({}); // trainer name -> edited copy
  const [firebaseTrainers, setFirebaseTrainers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [college, setCollege] = useState(EMPTY_COLLEGE);
  const [paymentDays, setPaymentDays] = useState({});

  useEffect(() => {
    const loadTrainers = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          where('role', '==', 'trainer')
        );

        const snapshot = await getDocs(q);

        setFirebaseTrainers(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
        );
      } catch (error) {
        console.error(error);
        setMessage('Unable to load trainers from Firebase.');
      }
    };

    loadTrainers();
  }, []);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMessage('');
    setTrainers([]);
    setDrafts({});
    setSelected([]);
    setSheetName('');
    setCollege(EMPTY_COLLEGE);

    try {
      const data = await file.arrayBuffer();
      const parsedWorkbook = XLSX.read(data, { cellDates: true });

      setWorkbook(parsedWorkbook);
      setFileName(file.name);
      setMessage('Select the worksheet containing the schedules.');
    } catch (error) {
      console.error(error);
      setWorkbook(null);
      setMessage('Unable to read this Excel workbook.');
    }
  };

  const handleSheetChange = (name) => {
    setSheetName(name);
    setSelected([]);
    setDrafts({});
    setMessage('');

    if (!workbook || !name) {
      setTrainers([]);
      setCollege(EMPTY_COLLEGE);
      return;
    }

    try {
      const sheet = workbook.Sheets[name];

      const rows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
        dateNF: 'dd-mmm-yyyy',
      });

      const extractedCollege = extractCollege(rows);
      const extracted = extractTrainers(rows);

      setCollege(extractedCollege);
      setTrainers(extracted);

      const missing = Object.entries(COLLEGE_FIELD_LABELS)
        .filter(([field]) => !extractedCollege[field])
        .map(([, label]) => label);

      if (!extracted.length) {
        setMessage(
          'No trainer tables were detected. Check the selected worksheet and its headers.'
        );
      } else if (missing.length) {
        setMessage(
          `Found ${extracted.length} trainers, but could not find ${missing.join(
            ', '
          )} in the sheet. You can type the missing value(s) in the Assignment details section.`
        );
      } else {
        setMessage(`Found ${extracted.length} trainers.`);
      }
    } catch (error) {
      console.error(error);
      setTrainers([]);
      setCollege(EMPTY_COLLEGE);
      setMessage('Unable to parse the selected worksheet.');
    }
  };

  const resolveEmail = (name) => {
    const matches = firebaseTrainers.filter(
      (trainer) =>
        normalize(trainer.name) === normalize(name) &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trainer.email || '')
    );

    return matches.length === 1 ? matches[0].email : '';
  };

  const toggleTrainer = (name) => {
    setSelected((previous) =>
      previous.includes(name)
        ? previous.filter((item) => item !== name)
        : [...previous, name]
    );
  };

  // The edited draft if there is one, otherwise the parsed sheet data.
  const effectiveTrainer = (trainer) => drafts[trainer.name] ?? trainer;

  const updateDraft = (name, updater) => {
    setDrafts((previous) => {
      const original = trainers.find((t) => t.name === name);
      const base = previous[name] ?? original;
      if (!base) return previous;

      const copy = JSON.parse(JSON.stringify(base));
      updater(copy);

      return { ...previous, [name]: copy };
    });
  };

  const resetDraft = (name) => {
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[name];
      return next;
    });
  };

  const updateCollege = (field, value) =>
    setCollege((previous) => ({ ...previous, [field]: value }));

  const collegeComplete = Boolean(
    college.name.trim() && college.address.trim() && college.code.trim()
  );

  const sendEmails = async () => {
    const chosen = trainers
      .filter((trainer) => selected.includes(trainer.name))
      .map(effectiveTrainer);

    if (!chosen.length) {
      setMessage('Select at least one trainer.');
      return;
    }

    if (!collegeComplete) {
      setMessage(
        'College Name, Address and Project Code are all required. Fill the missing value(s) in Assignment details.'
      );
      return;
    }

    const missingDays = chosen.filter((trainer) => {
      const days = Number(paymentDays[trainer.name]);
      return !Number.isInteger(days) || days <= 0;
    });

    if (missingDays.length) {
      setMessage(
        `Enter the payment cycle (whole number of days) for: ${missingDays
          .map((t) => t.name)
          .join(', ')}`
      );
      return;
    }

    const unresolved = chosen.filter(
      (trainer) => !resolveEmail(trainer.name)
    );

    if (unresolved.length) {
      setMessage(
        `Resolve missing or ambiguous Firebase email matches for: ${unresolved
          .map((t) => t.name)
          .join(', ')}`
      );
      return;
    }

    const empty = chosen.filter(
      (trainer) => !trainer.rows.length && !trainer.summary.length
    );

    if (empty.length) {
      setMessage(
        `No schedule or summary rows left for: ${empty
          .map((t) => t.name)
          .join(', ')}`
      );
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/send-trainer-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          college: {
            name: college.name.trim(),
            address: college.address.trim(),
            code: college.code.trim(),
          },
          trainers: chosen.map((trainer) => ({
            ...trainer,
            email: resolveEmail(trainer.name),
            paymentDays: Number(paymentDays[trainer.name]),
          })),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Unable to send emails.');
      }

      setMessage(`Email request accepted for ${result.count} trainers.`);
    } catch (error) {
      console.error(error);
      setMessage(error.message || 'Email sending failed.');
    } finally {
      setLoading(false);
    }
  };

  const selectedTrainers = trainers.filter((t) =>
    selected.includes(t.name)
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">
          Trainer Schedule Emails
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Upload a schedule workbook, select its worksheet, preview or edit
          each email, and send the selected trainers their schedules.
        </p>
      </div>

      <section className="rounded-xl border bg-white p-5 space-y-4">
        <label className="block text-sm font-medium">
          Upload Excel workbook
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFile}
            className="mt-2 block w-full text-sm"
          />
        </label>

        {fileName && (
          <p className="text-sm text-gray-600">File: {fileName}</p>
        )}

        {workbook && (
          <label className="block text-sm font-medium">
            Select worksheet
            <select
              value={sheetName}
              onChange={(event) => handleSheetChange(event.target.value)}
              className="mt-2 w-full rounded-lg border p-3"
            >
              <option value="">Choose a worksheet</option>
              {workbook.SheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {sheetName && (
        <section className="rounded-xl border bg-white p-5 space-y-3">
          <h3 className="font-semibold">Assignment details (from sheet)</h3>
          <p className="text-xs text-gray-500">
            Read from the sheet. Edit any value here if it is wrong; it will
            be used in every email.
          </p>

          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {Object.entries(COLLEGE_FIELD_LABELS).map(([field, label]) => (
              <label
                key={field}
                className={`text-xs text-gray-500 ${
                  field === 'address' ? 'sm:col-span-2' : ''
                }`}
              >
                {label}
                <input
                  type="text"
                  value={college[field]}
                  onChange={(e) => updateCollege(field, e.target.value)}
                  placeholder={`${label} not found in sheet`}
                  className={`mt-1 w-full rounded-lg border p-2 text-sm font-medium text-gray-900 ${
                    college[field].trim() ? '' : 'border-red-400'
                  }`}
                />
              </label>
            ))}
          </div>
        </section>
      )}

      {trainers.length > 0 && (
        <section className="rounded-xl border bg-white p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold">Trainers ({trainers.length})</h3>

            <button
              type="button"
              className="text-sm text-blue-800"
              onClick={() =>
                setSelected(
                  selected.length === trainers.length
                    ? []
                    : trainers.map((t) => t.name)
                )
              }
            >
              {selected.length === trainers.length
                ? 'Deselect all'
                : 'Select all'}
            </button>
          </div>

          <div className="space-y-3">
            {trainers.map((trainer) => {
              const email = resolveEmail(trainer.name);

              return (
                <div
                  key={trainer.name}
                  className="flex flex-wrap items-start gap-3 rounded-lg border p-3"
                >
                  <label className="flex min-w-0 flex-1 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(trainer.name)}
                      onChange={() => toggleTrainer(trainer.name)}
                      className="mt-1"
                    />

                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{trainer.name}</span>
                      <span className="block text-sm text-gray-500">
                        {trainer.domain || 'Domain not specified'}
                        {' · '}
                        {trainer.rows.length} schedule rows
                        {' · '}
                        {trainer.summary.length} summary rows
                      </span>
                      <span
                        className={`block text-xs ${
                          email ? 'text-green-700' : 'text-red-600'
                        }`}
                      >
                        {email || 'Email missing or name match ambiguous'}
                      </span>
                    </span>
                  </label>

                  <label className="w-40 text-xs font-medium text-gray-600">
                    Payment cycle (days)
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={paymentDays[trainer.name] ?? ''}
                      onChange={(event) =>
                        setPaymentDays((previous) => ({
                          ...previous,
                          [trainer.name]: event.target.value,
                        }))
                      }
                      placeholder="30"
                      className="mt-1 w-full rounded-lg border p-2 text-sm"
                    />
                  </label>
                </div>
              );
            })}
          </div>

          {selectedTrainers.length > 0 && (
            <div className="mt-6 space-y-3">
              <h3 className="font-semibold">
                Email previews ({selectedTrainers.length})
              </h3>

              {selectedTrainers.map((trainer) => (
                <TrainerPreview
                  key={trainer.name}
                  trainer={effectiveTrainer(trainer)}
                  isEdited={Boolean(drafts[trainer.name])}
                  college={college}
                  paymentDays={paymentDays[trainer.name]}
                  email={resolveEmail(trainer.name)}
                  onChange={(updater) => updateDraft(trainer.name, updater)}
                  onReset={() => resetDraft(trainer.name)}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={sendEmails}
            disabled={!selected.length || loading || !collegeComplete}
            className={`${buttonClass} mt-5 bg-blue-900 text-white`}
          >
            {loading ? 'Sending...' : `Send emails (${selected.length})`}
          </button>
        </section>
      )}

      {message && (
        <p role="status" className="text-sm text-gray-700">
          {message}
        </p>
      )}
    </div>
  );
}