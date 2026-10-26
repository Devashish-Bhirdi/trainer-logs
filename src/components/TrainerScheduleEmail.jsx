import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { buildScheduleHtml } from '../utils/trainerEmailTemplate';
import TopicPicker, {
  useProjectCurriculum,
  picksToTopics,
} from './Topicpicker';

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

    const owner = hasSchedule ? currentTrainer : currentTrainer || lastTrainer;

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
          edited at the top of the page.
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
                onChange={(e) => setSummaryField(index, 'total', e.target.value)}
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
  const [topicState, setTopicState] = useState({}); // name -> { campusId, batchId, picks }
  const [firebaseTrainers, setFirebaseTrainers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [activeName, setActiveName] = useState(''); // '' = drawer closed
  const [tab, setTab] = useState('topics'); // 'topics' | 'modify' | 'preview'
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [college, setCollege] = useState(EMPTY_COLLEGE);
  const [paymentDays, setPaymentDays] = useState({});

  // Campuses, batches and curriculum for the project code in the sheet
  const curriculumData = useProjectCurriculum(college.code.trim());

  useEffect(() => {
    const loadTrainers = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          where('role', '==', 'trainer')
        );

        const snapshot = await getDocs(q);

        setFirebaseTrainers(
          snapshot.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          }))
        );
      } catch (error) {
        console.error(error);
        setMessage('Unable to load trainers from Firebase.');
      }
    };

    loadTrainers();
  }, []);

  // Close the drawer with Escape
  useEffect(() => {
    if (!activeName) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') setActiveName('');
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeName]);

  const resetSheetState = () => {
    setTrainers([]);
    setDrafts({});
    setTopicState({});
    setSelected([]);
    setActiveName('');
    setTab('topics');
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
          )} in the sheet. Type the missing value(s) in College details.`
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

  // Topics picked for a trainer; they go into the mail as soon as they are ticked
  const topicsFor = (name) => picksToTopics(topicState[name]?.picks);

  // The edited draft if there is one, otherwise the parsed sheet data.
  // Picked topics are attached either way.
  const effectiveTrainer = (trainer) => ({
    ...(drafts[trainer.name] ?? trainer),
    topics: topicsFor(trainer.name),
  });

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

  const updateTopicState = (name, patch) =>
    setTopicState((previous) => ({
      ...previous,
      [name]: { ...previous[name], ...patch },
    }));

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

    const noTopics = chosen.filter((trainer) => !trainer.topics.length);

    if (noTopics.length) {
      setMessage(
        `Choose topics for: ${noTopics
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

  /* ---------- Derived values ---------- */

  const activeOriginal = trainers.find((t) => t.name === activeName) ?? null;
  const active = activeOriginal ? effectiveTrainer(activeOriginal) : null;
  const activeEmail = active ? resolveEmail(active.name) : '';

  console.log('topics for preview', active?.topics);
  const previewDoc = active
    ? `<!doctype html><html><body style="margin:12px;background:#ffffff;">${buildScheduleHtml(
        active,
        college,
        paymentDays[active.name] || '___'
      )}</body></html>`
    : '';

  const allSelected =
    trainers.length > 0 && selected.length === trainers.length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">
          Trainer Schedule Emails
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Upload a workbook, set the topics for each trainer, then send.
        </p>
      </div>

      {/* ===== Step 1: workbook + college details ===== */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,1fr)_2fr]">
          <div className="space-y-3">
            <p className={sectionLabel}>1 · Workbook</p>

            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              aria-label="Upload Excel workbook"
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
            />

            {fileName && (
              <p className="truncate text-xs text-slate-600">{fileName}</p>
            )}

            {workbook && (
              <select
                value={sheetName}
                onChange={(event) => handleSheetChange(event.target.value)}
                aria-label="Worksheet"
                className={inputClass}
              >
                <option value="">Choose a worksheet</option>
                {workbook.SheetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {sheetName && (
            <div className="space-y-3">
              <p className={sectionLabel}>College details</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {Object.entries(COLLEGE_FIELD_LABELS).map(([field, label]) => (
                  <label
                    key={field}
                    className="text-xs font-semibold text-slate-600"
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
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===== Step 2: trainer table ===== */}
      {trainers.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <p className={sectionLabel}>
              2 · Trainers · {selected.length} of {trainers.length} selected
            </p>
            <button
              type="button"
              disabled={!selected.length || loading || !collegeComplete}
              onClick={sendEmails}
              className="min-h-[40px] rounded-lg bg-blue-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? 'Sending...' : `Send emails (${selected.length})`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                  <th className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      aria-label="Select all trainers"
                      onChange={() =>
                        setSelected(allSelected ? [] : trainers.map((t) => t.name))
                      }
                    />
                  </th>
                  <th className="px-2 py-2">Trainer</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Topics</th>
                  <th className="px-2 py-2">Payment days</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {trainers.map((original) => {
                  const trainer = effectiveTrainer(original);
                  const email = resolveEmail(trainer.name);
                  const lessonCount = trainer.topics.reduce(
                    (n, t) => n + t.lessons.length,
                    0
                  );

                  return (
                    <tr key={trainer.name} className="border-t border-slate-200">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(trainer.name)}
                          onChange={() => toggleTrainer(trainer.name)}
                          aria-label={`Include ${trainer.name} in send`}
                        />
                      </td>

                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">
                            {trainer.name}
                          </span>
                          {drafts[trainer.name] && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                              Edited
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600">
                          {trainer.domain || 'Domain not specified'} ·{' '}
                          {trainer.rows.length} schedule · {trainer.summary.length}{' '}
                          summary
                        </p>
                      </td>

                      <td
                        className={`px-2 py-3 text-xs font-medium ${
                          email ? 'text-green-800' : 'text-red-700'
                        }`}
                      >
                        {email || 'Missing or ambiguous'}
                      </td>

                      <td className="px-2 py-3 text-xs font-medium">
                        {lessonCount ? (
                          <span className="text-green-800">
                            ✓ {lessonCount} lessons
                          </span>
                        ) : (
                          <span className="text-amber-800">Not set</span>
                        )}
                      </td>

                      <td className="px-2 py-3">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          aria-label={`Payment cycle days for ${trainer.name}`}
                          value={paymentDays[trainer.name] ?? ''}
                          onChange={(e) =>
                            setPaymentDays((previous) => ({
                              ...previous,
                              [trainer.name]: e.target.value,
                            }))
                          }
                          placeholder="30"
                          className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                        />
                      </td>

                      <td className="px-2 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveName(trainer.name);
                            setTab('topics');
                          }}
                          className="rounded-lg border border-blue-900 px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-50"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {message && (
        <p role="status" className="text-sm text-slate-700">
          {message}
        </p>
      )}

      {/* ===== Side drawer for one trainer ===== */}
      {active && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActiveName('');
          }}
        >
          <div
            role="dialog"
            aria-label={`Email for ${active.name}`}
            className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-900">
                  {active.name}
                </p>
                <p
                  className={`text-xs font-medium ${
                    activeEmail ? 'text-green-800' : 'text-red-700'
                  }`}
                >
                  {activeEmail || 'Email missing or name match ambiguous'}
                </p>
                <p className="text-xs text-slate-600">
                  {active.domain || 'Domain not specified'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveName('')}
                className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close ✕
              </button>
            </div>

            <div className="flex gap-1 border-b border-slate-200 px-5 pt-2">
              {[
                ['topics', 'Topics'],
                ['modify', 'Modify mail'],
                ['preview', 'Preview'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tab === key}
                  onClick={() => setTab(key)}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                    tab === key
                      ? 'border-blue-900 text-blue-900'
                      : 'border-transparent text-slate-600'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 p-5">
              {tab === 'topics' && (
                <div className="rounded-lg border border-slate-200 bg-white p-5">
                  <TopicPicker
                    domain={active.domain}
                    data={curriculumData}
                    value={topicState[active.name] || {}}
                    onChange={(patch) => updateTopicState(active.name, patch)}
                  />
                </div>
              )}

              {tab === 'modify' && (
                <div className="rounded-lg border border-slate-200 bg-white p-5">
                  <TrainerEditor
                    trainer={active}
                    isEdited={Boolean(drafts[active.name])}
                    onChange={(updater) => updateDraft(active.name, updater)}
                    onReset={() => resetDraft(active.name)}
                  />
                </div>
              )}

              {tab === 'preview' && (
                <iframe
                  title={`Email preview for ${active.name}`}
                  srcDoc={previewDoc}
                  sandbox=""
                  className="h-[calc(100vh-260px)] w-full rounded-lg border border-slate-200 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}