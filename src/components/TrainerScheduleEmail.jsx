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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- Excel parsing ---------- */

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
  let currentTrainer = '';
  let lastTrainer = '';

  const getTrainer = (name) => {
    const key = normalize(name);

    if (!grouped.has(key)) {
      grouped.set(key, {
        name,
        domain: '',
        costPerHour: '',
        costPerDay: '',
        rows: [],
        summary: [],
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

    if (!hasSchedule && !hasSummary) continue;

    const owner = hasSchedule
      ? currentTrainer
      : currentTrainer || lastTrainer;

    if (!owner) continue;

    const trainer = getTrainer(owner);

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

/* ---------- Small UI pieces ---------- */

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800';

const cellInput =
  'w-full min-w-[84px] rounded border border-slate-300 bg-white p-1.5 text-xs text-slate-900';

const sectionLabel =
  'text-[11px] font-bold uppercase tracking-wider text-slate-500';

const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/* ---------- Modify-mail editor for one trainer ---------- */

function TrainerEditor({ trainer, onChange, onReset, isEdited }) {
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-600">
          Changes apply only to this trainer&apos;s email. College details are
          edited in the sidebar.
        </p>
        {isEdited && (
          <button
            type="button"
            onClick={onReset}
            className="text-sm font-medium text-red-700"
          >
            Reset to sheet values
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ['domain', 'Domain'],
          ['costPerHour', 'Cost / hour'],
          ['costPerDay', 'Cost / day'],
        ].map(([field, label]) => (
          <label key={field} className="text-xs font-semibold text-slate-600">
            {label}
            <input
              type="text"
              value={trainer[field] ?? ''}
              onChange={(e) => setField(field, e.target.value)}
              className={`${inputClass} mt-1`}
            />
          </label>
        ))}
      </div>

      <div>
        <p className={`${sectionLabel} mb-2`}>Schedule rows</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50">
                {SCHEDULE_FIELDS.map(([, label]) => (
                  <th
                    key={label}
                    className="px-2 py-2 text-left font-semibold text-slate-600"
                  >
                    {label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {trainer.rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-200">
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
                      className="px-2 text-red-700"
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
                Object.fromEntries(SCHEDULE_FIELDS.map(([field]) => [field, '']))
              );
            })
          }
          className="mt-2 text-sm font-medium text-blue-900"
        >
          + Add schedule row
        </button>
      </div>

      <div>
        <p className={`${sectionLabel} mb-2`}>Summary rows</p>
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
                className="px-2 text-red-700"
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
          className="mt-2 text-sm font-medium text-blue-900"
        >
          + Add summary row
        </button>
      </div>
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
  const [activeName, setActiveName] = useState('');
  const [tab, setTab] = useState('preview'); // 'preview' | 'modify'
  const [editCollege, setEditCollege] = useState(false);
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

  const resetSheetState = () => {
    setTrainers([]);
    setDrafts({});
    setSelected([]);
    setActiveName('');
    setTab('preview');
    setCollege(EMPTY_COLLEGE);
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMessage('');
    setSheetName('');
    resetSheetState();

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
    setMessage('');
    resetSheetState();

    if (!workbook || !name) return;

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
      setActiveName(extracted[0]?.name ?? '');

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
          )} in the sheet. Type the missing value(s) in the College details section.`
        );
      } else {
        setMessage(`Found ${extracted.length} trainers.`);
      }
    } catch (error) {
      console.error(error);
      resetSheetState();
      setMessage('Unable to parse the selected worksheet.');
    }
  };

  const resolveEmail = (name) => {
    const matches = firebaseTrainers.filter(
      (trainer) =>
        normalize(trainer.name) === normalize(name) &&
        EMAIL_REGEX.test(trainer.email || '')
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
        'College Name, Address and Project Code are all required. Fill the missing value(s) in College details.'
      );
      setEditCollege(true);
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

    const unresolved = chosen.filter((trainer) => !resolveEmail(trainer.name));

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

  /* ---------- Derived values for the active trainer ---------- */

  const activeOriginal =
    trainers.find((t) => t.name === activeName) ?? trainers[0] ?? null;
  const active = activeOriginal ? effectiveTrainer(activeOriginal) : null;
  const activeEmail = active ? resolveEmail(active.name) : '';
  const activeDays = active ? paymentDays[active.name] : '';

  const previewDoc = active
    ? `<!doctype html><html><body style="margin:12px;background:#ffffff;">${buildScheduleHtml(
        active,
        college,
        activeDays || '___'
      )}</body></html>`
    : '';

  const showCollegeEditor = editCollege || (sheetName && !collegeComplete);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Trainer Schedule Emails
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a schedule workbook, pick a trainer, preview or edit their
          email, then send.
        </p>
      </div>

      <div className="flex min-h-[680px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white lg:flex-row">
        {/* ================= Left sidebar ================= */}
        <aside className="flex w-full flex-col gap-5 border-b border-slate-200 bg-slate-50 p-4 lg:w-[340px] lg:shrink-0 lg:border-b-0 lg:border-r">
          {/* Upload */}
          <section className="space-y-3">
            <p className={sectionLabel}>Workbook</p>

            <label className="block text-sm font-medium text-slate-800">
              <span className="sr-only">Upload Excel workbook</span>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFile}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
            </label>

            {fileName && (
              <p className="truncate text-xs text-slate-600">{fileName}</p>
            )}

            {workbook && (
              <label className="block text-xs font-semibold text-slate-600">
                Worksheet
                <select
                  value={sheetName}
                  onChange={(event) => handleSheetChange(event.target.value)}
                  className={`${inputClass} mt-1`}
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

          {/* College details */}
          {sheetName && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <p className={sectionLabel}>College details</p>
                {collegeComplete && (
                  <button
                    type="button"
                    onClick={() => setEditCollege((v) => !v)}
                    className="text-xs font-semibold text-blue-900"
                  >
                    {editCollege ? 'Done' : 'Edit'}
                  </button>
                )}
              </div>

              {showCollegeEditor ? (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                  {Object.entries(COLLEGE_FIELD_LABELS).map(
                    ([field, label]) => (
                      <label
                        key={field}
                        className="block text-xs font-semibold text-slate-600"
                      >
                        {label}
                        <input
                          type="text"
                          value={college[field]}
                          onChange={(e) => updateCollege(field, e.target.value)}
                          placeholder={`${label} not found in sheet`}
                          className={`${inputClass} mt-1 ${
                            college[field].trim() ? '' : 'border-red-400'
                          }`}
                        />
                      </label>
                    )
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600">
                  <p className="text-sm font-semibold text-slate-900">
                    {college.name}
                  </p>
                  <p>{college.address}</p>
                  <p>
                    Project{' '}
                    <span className="font-semibold text-blue-900">
                      {college.code}
                    </span>
                  </p>
                </div>
              )}
            </section>
          )}

          {/* Trainer list */}
          {trainers.length > 0 && (
            <section className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className={sectionLabel}>
                  Trainers · {selected.length} of {trainers.length}
                </p>
                <button
                  type="button"
                  className="text-xs font-semibold text-blue-900"
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

              <ul className="max-h-[460px] space-y-2 overflow-y-auto pr-1">
                {trainers.map((original) => {
                  const trainer = effectiveTrainer(original);
                  const email = resolveEmail(trainer.name);
                  const isActive = active?.name === trainer.name;
                  const isChecked = selected.includes(trainer.name);
                  const daysMissing =
                    isChecked &&
                    !(Number(paymentDays[trainer.name]) > 0);

                  return (
                    <li
                      key={trainer.name}
                      className={`flex items-start gap-3 rounded-lg border p-3 ${
                        isActive
                          ? 'border-blue-800 bg-blue-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTrainer(trainer.name)}
                        aria-label={`Include ${trainer.name} in send`}
                        className="mt-1 h-4 w-4 shrink-0"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          setActiveName(trainer.name);
                          setTab('preview');
                        }}
                        aria-current={isActive}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">
                            {trainer.name}
                          </span>
                          {drafts[trainer.name] && (
                            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                              Edited
                            </span>
                          )}
                        </span>

                        {/* Per-trainer info line from the Excel sheet */}
                        <span className="mt-0.5 block text-xs text-slate-600">
                          {trainer.domain || 'Domain not specified'}
                          {' · '}
                          {trainer.rows.length} schedule rows
                          {' · '}
                          {trainer.summary.length} summary rows
                        </span>

                        <span
                          className={`mt-0.5 block text-xs font-medium ${
                            email ? 'text-green-800' : 'text-red-700'
                          }`}
                        >
                          {email || 'Email missing or name match ambiguous'}
                        </span>

                        {daysMissing && (
                          <span className="mt-0.5 block text-xs font-medium text-amber-800">
                            Payment days needed
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>

        {/* ================= Right pane ================= */}
        <main className="flex min-w-0 flex-1 flex-col">
          {active ? (
            <>
              {/* Header */}
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-semibold text-slate-900">
                    {active.name}
                  </p>
                  <p
                    className={`truncate text-xs font-medium ${
                      activeEmail ? 'text-green-800' : 'text-red-700'
                    }`}
                  >
                    {activeEmail ||
                      'Email missing or name match ambiguous'}
                  </p>
                  <p className="text-xs text-slate-600">
                    {active.domain || 'Domain not specified'}
                    {' · '}
                    {active.rows.length} schedule rows
                    {' · '}
                    {active.summary.length} summary rows
                  </p>
                </div>

                <div
                  className="flex rounded-lg bg-slate-100 p-1"
                  role="group"
                  aria-label="Preview or modify"
                >
                  {[
                    ['preview', 'Preview'],
                    ['modify', 'Modify mail'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={tab === key}
                      onClick={() => setTab(key)}
                      className={`rounded-md px-4 py-2 text-sm font-semibold ${
                        tab === key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto bg-slate-100 p-5">
                {tab === 'preview' ? (
                  <iframe
                    title={`Email preview for ${active.name}`}
                    srcDoc={previewDoc}
                    sandbox=""
                    className="h-[560px] w-full rounded-lg border border-slate-200 bg-white"
                  />
                ) : (
                  <div className="rounded-lg border border-slate-200 bg-white p-5">
                    <TrainerEditor
                      trainer={active}
                      isEdited={Boolean(drafts[active.name])}
                      onChange={(updater) => updateDraft(active.name, updater)}
                      onReset={() => resetDraft(active.name)}
                    />
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 px-5 py-3">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  Payment cycle (days) for {active.name}
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={activeDays ?? ''}
                    onChange={(event) =>
                      setPaymentDays((previous) => ({
                        ...previous,
                        [active.name]: event.target.value,
                      }))
                    }
                    placeholder="30"
                    className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900"
                  />
                </label>

                {!selected.includes(active.name) && (
                  <button
                    type="button"
                    onClick={() => toggleTrainer(active.name)}
                    className="text-sm font-semibold text-blue-900"
                  >
                    + Include in send
                  </button>
                )}

                <span className="flex-1" />

                <button
                  type="button"
                  onClick={sendEmails}
                  disabled={!selected.length || loading || !collegeComplete}
                  className="min-h-[44px] rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {loading ? 'Sending...' : `Send emails (${selected.length})`}
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-slate-600">
              Upload a workbook and choose a worksheet to see trainer emails
              here.
            </div>
          )}
        </main>
      </div>

      {message && (
        <p role="status" className="text-sm text-slate-700">
          {message}
        </p>
      )}
    </div>
  );
}