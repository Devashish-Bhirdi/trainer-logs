import * as XLSX from 'xlsx';

// 'YYYY-MM-DD' -> a real Date (local midnight), so Excel can sort and filter it as a date
const dateKeyToDate = (key) => {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// safe for file names on every OS
const cleanForFileName = (s) =>
  String(s || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_');

// Column width (in characters) from the longest value in it, within min / max limits
const autoWidth = (rows, headers, { min = 10, max = 60 } = {}) =>
  headers.map((h) => {
    const longest = rows.reduce((n, r) => Math.max(n, String(r[h] ?? '').length), h.length);
    return { wch: Math.min(max, Math.max(min, longest + 2)) };
  });

// Applies a number format to every data cell in one column of a sheet
const formatColumn = (ws, colIndex, format) => {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: colIndex })];
    if (cell) cell.z = format;
  }
};

/**
 * Exports the daily coverage table to an .xlsx file with two sheets:
 *   - Summary         : the filters used and the headline numbers
 *   - Daily Coverage  : one row per batch, per day
 *
 * @param {object[]} dailyRows  the dailyRows returned by buildMapping()
 * @param {{ project?: string, campus?: string, batch?: string, trainer?: string,
 *           startDate?: string, endDate?: string }} meta  display names for the active filters
 */
export const exportMappingToExcel = (dailyRows = [], meta = {}) => {
  if (dailyRows.length === 0) {
    throw new Error('There is no data to export.');
  }

  // ---------- Daily Coverage ----------
  const dailyHeaders = [
    'Date', 'Batch', 'Trainer(s)', 'Topic(s)', 'Lessons covered', 'Extra topics', 'Hours', 'Students',
  ];
  const dailyData = dailyRows.map((r) => ({
    'Date': dateKeyToDate(r.dateKey),
    'Batch': r.batchName || 'N/A',
    'Trainer(s)': r.trainers.join(', '),
    'Topic(s)': r.topics.join(', '),
    'Lessons covered': r.covered.join(', '),
    'Extra topics': r.extra.join(', '),
    'Hours': Number(r.hours.toFixed(1)),
    'Students': r.students ?? '',
  }));

  const dailySheet = XLSX.utils.json_to_sheet(dailyData, { header: dailyHeaders, cellDates: true });
  dailySheet['!cols'] = autoWidth(dailyData, dailyHeaders);
  formatColumn(dailySheet, 0, 'dd mmm yyyy');
  formatColumn(dailySheet, 6, '0.0');

  // ---------- Summary ----------
  const totalHours = dailyRows.reduce((n, r) => n + r.hours, 0);

  const summaryRows = [
    ['Trainer Content Mapping'],
    ['Exported on', new Date().toLocaleString()],
    [],
    ['Filters'],
    ['Project', meta.project || 'All'],
    ['Campus', meta.campus || 'All'],
    ['Batch', meta.batch || 'All'],
    ['Trainer', meta.trainer || 'All'],
    ['From', meta.startDate || '—'],
    ['To', meta.endDate || '—'],
    [],
    ['Totals'],
    ['Sessions (batch-days)', dailyRows.length],
    ['Hours logged', Number(totalHours.toFixed(1))],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 24 }, { wch: 36 }];

  // ---------- Workbook ----------
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(workbook, dailySheet, 'Daily Coverage');

  const nameParts = ['Mapping', meta.project, meta.campus, meta.batch]
    .map(cleanForFileName)
    .filter(Boolean);
  const stamp = new Date().toISOString().slice(0, 10);

  XLSX.writeFile(workbook, `${nameParts.join('_')}_${stamp}.xlsx`, { cellDates: true });
};