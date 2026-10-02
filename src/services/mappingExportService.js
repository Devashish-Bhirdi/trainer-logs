import * as XLSX from 'xlsx-js-style';

const MS_PER_DAY = 86400000;

// 'YYYY-MM-DD' -> Excel date serial number (days since 1899-12-30).
// A plain number plus a "dd/mm/yyyy" format: no time zones, no "T00:00:00Z".
const dateKeyToSerial = (key) => {
  if (!key) return '';
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / MS_PER_DAY);
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

// Consecutive rows that share the same key -> [{ key, from, to }] (indexes into rows)
const runsOf = (rows, keyOf) => {
  const runs = [];
  rows.forEach((row, i) => {
    const key = keyOf(row);
    const last = runs[runs.length - 1];
    if (last && last.key === key) last.to = i;
    else runs.push({ key, from: i, to: i });
  });
  return runs;
};

// ---------- look ----------
const BORDER_SIDE = { style: 'thin', color: { rgb: '808080' } };
const BORDER = { top: BORDER_SIDE, bottom: BORDER_SIDE, left: BORDER_SIDE, right: BORDER_SIDE };

const HEADER_STYLE = {
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: BORDER,
};

const BODY_STYLE = {
  alignment: { vertical: 'top', wrapText: true },
  border: BORDER,
};

// for columns whose cells are merged over several rows
const MERGED_STYLE = {
  alignment: { vertical: 'center', wrapText: true },
  border: BORDER,
};

/**
 * Turns an array of row objects into a styled sheet:
 * blue header, borders on every cell, wrapped text.
 *
 * options.formats       : { 'Header name': 'number format' }  applied to numeric cells in that column
 * options.widths        : { 'Header name': characters }       fixed column width instead of auto
 * options.merges        : [{ col: 'Header name', from, to }]  merge data rows from..to (0-based) in that column
 * options.filterButtons : show filter buttons on the header row (default true; off when cells are merged)
 */
const buildSheet = (
  data,
  headers,
  { formats = {}, widths = {}, merges = [], filterButtons = true } = {}
) => {
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });

  const cols = autoWidth(data, headers);
  headers.forEach((h, i) => {
    if (widths[h]) cols[i] = { wch: widths[h] };
  });
  ws['!cols'] = cols;
  ws['!rows'] = [{ hpt: 22 }];

  const mergedColumns = new Set(merges.map((m) => m.col));

  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      // empty cells still need to exist, otherwise they would have no border
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      const cell = ws[addr];

      if (r === range.s.r) {
        cell.s = HEADER_STYLE;
      } else {
        cell.s = mergedColumns.has(headers[c]) ? MERGED_STYLE : BODY_STYLE;
        const format = formats[headers[c]];
        if (format && cell.t === 'n') cell.z = format;
      }
    }
  }

  // +1 on the row because row 0 is the header
  const mergeRanges = merges
    .filter((m) => m.to > m.from)
    .map((m) => {
      const c = headers.indexOf(m.col);
      return { s: { r: m.from + 1, c }, e: { r: m.to + 1, c } };
    });
  if (mergeRanges.length > 0) ws['!merges'] = mergeRanges;

  if (filterButtons) ws['!autofilter'] = { ref: ws['!ref'] };
  return ws;
};

/**
 * Exports the mapping page to an .xlsx file with two sheets:
 *   - Daily Coverage  : one row per batch, per day
 *   - Pending Lessons : one row per batch / topic / module, with what is still pending
 *
 * @param {object[]} dailyRows    the dailyRows returned by buildMapping()
 * @param {{ project?: string, campus?: string, batch?: string }} meta  display names of the active filters (used for the file name)
 * @param {object[]} pendingRows  the pendingRows returned by buildMapping()
 */
export const exportMappingToExcel = (dailyRows = [], meta = {}, pendingRows = []) => {
  const hasDaily = dailyRows.length > 0;
  const hasPending = pendingRows.length > 0;

  if (!hasDaily && !hasPending) {
    throw new Error('There is no data to export.');
  }

  const workbook = XLSX.utils.book_new();

  // ---------- Daily Coverage ----------
  if (hasDaily) {
    const headers = [
      'Date', 'Batch', 'Trainer(s)', 'Topic(s)', 'Lessons covered', 'Extra topics', 'Hours', 'Students',
    ];
    const data = dailyRows.map((r) => ({
      'Date': dateKeyToSerial(r.dateKey),
      'Batch': r.batchName || 'N/A',
      'Trainer(s)': r.trainers.join(', '),
      'Topic(s)': r.topics.join(', '),
      'Lessons covered': r.covered.join(', '),
      'Extra topics': r.extra.join(', '),
      'Hours': Number(r.hours.toFixed(1)),
      'Students': r.students ?? '',
    }));

    const sheet = buildSheet(data, headers, {
      formats: { Date: 'dd/mm/yyyy', Hours: '0.0' },
      widths: { Date: 13 },
    });
    XLSX.utils.book_append_sheet(workbook, sheet, 'Daily Coverage');
  }

  // ---------- Pending Lessons (flat, repeated Campus / Batch merged) ----------
  if (hasPending) {
    const showCampus = pendingRows.some((r) => r.campusName);
    const headers = [
      ...(showCampus ? ['Campus'] : []),
      'Batch', 'Topic', 'Module', 'Progress', 'Covered', 'Hours covered', 'Pending', 'Pending lessons',
    ];

    // pendingRows is sorted by campus, then batch, so equal values are always next to each other
    const campusRuns = showCampus ? runsOf(pendingRows, (r) => r.campusName || '') : [];
    const batchRuns = runsOf(pendingRows, (r) => `${r.campusName || ''}||${r.batchId}`);
    const campusStarts = new Set(campusRuns.map((run) => run.from));
    const batchStarts = new Set(batchRuns.map((run) => run.from));

    const data = pendingRows.map((r, i) => {
      const row = {};
      // only the first row of each run carries the value; the rest are covered by the merge
      if (showCampus) row['Campus'] = campusStarts.has(i) ? r.campusName || 'N/A' : '';
      row['Batch'] = batchStarts.has(i) ? r.batchName || 'N/A' : '';
      row['Topic'] = r.topic;
      row['Module'] = r.module;
      row['Progress'] = r.total ? r.covered / r.total : 0;          // shown as a percentage
      row['Covered'] = `${r.covered} / ${r.total}`;
      row['Hours covered'] = Number(r.hoursCovered.toFixed(1));
      row['Pending'] = r.pendingLessons.length;
      row['Pending lessons'] = r.pendingLessons.length ? r.pendingLessons.join(', ') : 'All covered';
      return row;
    });

    const merges = [
      ...campusRuns.map((run) => ({ col: 'Campus', from: run.from, to: run.to })),
      ...batchRuns.map((run) => ({ col: 'Batch', from: run.from, to: run.to })),
    ];

    const sheet = buildSheet(data, headers, {
      formats: { Progress: '0%', 'Hours covered': '0.0' },
      merges,
      filterButtons: false, // filtering and sorting don't work well with merged cells
    });
    XLSX.utils.book_append_sheet(workbook, sheet, 'Pending Lessons');
  }

  const nameParts = ['Mapping', meta.project, meta.campus, meta.batch]
    .map(cleanForFileName)
    .filter(Boolean);
  const stamp = new Date().toISOString().slice(0, 10);

  XLSX.writeFile(workbook, `${nameParts.join('_')}_${stamp}.xlsx`);
};