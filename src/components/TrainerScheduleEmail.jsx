import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

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

// Labels that sit in one cell with the value in the next cell of the same row.
const collegeLabels = {
  name: ['collegename', 'college'],
  address: ['address', 'collegeaddress'],
};

/**
 * Finds "College Name" / "Address" labels anywhere in the sheet and returns
 * the value from the cell immediately to the right of the label.
 */
function extractCollege(rows) {
  const result = { name: '', address: '' };

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

// True for a "College Name | value" or "Address | value" row, so it is not
// mistaken for trainer data.
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

    // College Name / Address rows are sheet metadata, not trainer data.
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

export default function TrainerScheduleEmail() {
  const [workbook, setWorkbook] = useState(null);
  const [fileName, setFileName] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [trainers, setTrainers] = useState([]);
  const [firebaseTrainers, setFirebaseTrainers] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [college, setCollege] = useState({ name: '', address: '' });
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
    setSelected([]);
    setSheetName('');
    setCollege({ name: '', address: '' });

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
    setMessage('');

    if (!workbook || !name) {
      setTrainers([]);
      setCollege({ name: '', address: '' });
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

      const warnings = [];
      if (!extractedCollege.name) warnings.push('College Name');
      if (!extractedCollege.address) warnings.push('Address');

      if (!extracted.length) {
        setMessage(
          'No trainer tables were detected. Check the selected worksheet and its headers.'
        );
      } else if (warnings.length) {
        setMessage(
          `Found ${extracted.length} trainers, but could not find ${warnings.join(
            ' and '
          )} in the sheet. Add a "${warnings[0]}" label with its value in the next column.`
        );
      } else {
        setMessage(`Found ${extracted.length} trainers.`);
      }
    } catch (error) {
      console.error(error);
      setTrainers([]);
      setCollege({ name: '', address: '' });
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

  const sendEmails = async () => {
    const chosen = trainers.filter((trainer) =>
      selected.includes(trainer.name)
    );

    if (!chosen.length) {
      setMessage('Select at least one trainer.');
      return;
    }

    if (!college.name || !college.address) {
      setMessage(
        'College Name and Address were not found in the selected worksheet.'
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

    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/send-trainer-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          college: { name: college.name, address: college.address },
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">
          Trainer Schedule Emails
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Upload a schedule workbook, select its worksheet, and email the
          selected trainers their schedules.
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

          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-gray-500">College name</dt>
              <dd
                className={
                  college.name ? 'font-medium' : 'font-medium text-red-600'
                }
              >
                {college.name || 'Not found in sheet'}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-gray-500">Address</dt>
              <dd
                className={
                  college.address ? 'font-medium' : 'font-medium text-red-600'
                }
              >
                {college.address || 'Not found in sheet'}
              </dd>
            </div>
          </dl>
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

          <button
            type="button"
            onClick={sendEmails}
            disabled={
              !selected.length || loading || !college.name || !college.address
            }
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