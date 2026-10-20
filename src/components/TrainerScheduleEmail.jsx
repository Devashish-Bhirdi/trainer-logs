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
  const [collegeName, setCollegeName] = useState('');
  const [venue, setVenue] = useState('');
  const [paymentDays, setPaymentDays] = useState('');

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

      const extracted = extractTrainers(rows);
      setTrainers(extracted);

      setMessage(
        extracted.length
          ? `Found ${extracted.length} trainers.`
          : 'No trainer tables were detected. Check the selected worksheet and its headers.'
      );
    } catch (error) {
      console.error(error);
      setTrainers([]);
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

    if (!collegeName.trim() || !venue.trim()) {
      setMessage('Enter the college name and venue.');
      return;
    }

    const days = Number(paymentDays);

    if (!Number.isInteger(days) || days <= 0) {
      setMessage('Enter the payment cycle as a whole number of days.');
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
          college: { name: collegeName.trim(), venue: venue.trim() },
          paymentDays: days,
          trainers: chosen.map((trainer) => ({
            ...trainer,
            email: resolveEmail(trainer.name),
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

      <section className="rounded-xl border bg-white p-5 space-y-4">
        <h3 className="font-semibold">Assignment details</h3>

        <label className="block text-sm font-medium">
          College name
          <input
            type="text"
            value={collegeName}
            onChange={(event) => setCollegeName(event.target.value)}
            placeholder="ABC Institute of Technology"
            className="mt-2 w-full rounded-lg border p-3"
          />
        </label>

        <label className="block text-sm font-medium">
          Venue
          <input
            type="text"
            value={venue}
            onChange={(event) => setVenue(event.target.value)}
            placeholder="Main Auditorium, Pune Campus"
            className="mt-2 w-full rounded-lg border p-3"
          />
        </label>

        <label className="block text-sm font-medium">
          Payment cycle (days after invoice)
          <input
            type="number"
            min="1"
            step="1"
            value={paymentDays}
            onChange={(event) => setPaymentDays(event.target.value)}
            placeholder="30"
            className="mt-2 w-full rounded-lg border p-3"
          />
        </label>
      </section>

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
                <label
                  key={trainer.name}
                  className="flex items-start gap-3 rounded-lg border p-3"
                >
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
              );
            })}
          </div>

          <button
            type="button"
            onClick={sendEmails}
            disabled={!selected.length || loading}
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