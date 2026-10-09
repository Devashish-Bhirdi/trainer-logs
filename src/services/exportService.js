import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
  AlignmentType,
  TextRun,
  BorderStyle,
  ShadingType,
  TableLayoutType,
  VerticalAlign,
  HeadingLevel,
  PageBreak
} from 'docx';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

const fetchTrainersMap = async () => {
  const map = {};
  try {
    const q = query(collection(db, 'users'), where('role', '==', 'trainer'));
    const snap = await getDocs(q);
    snap.forEach(doc => {
      const d = doc.data() || {};
      const item = { name: d.name || '', email: d.email || '', uid: d.uid || doc.id };
      // map by document id and by uid (if present)
      map[doc.id] = item;
      if (d.uid) map[d.uid] = item;
    });
  } catch (err) {
    console.error('Error fetching trainers for export:', err);
  }
  return map;
};

export const exportToPDF = async (data, filters, companyName) => {
  // fetch trainers map from DB to resolve names/emails
  const trainersMap = await fetchTrainersMap();
  
  // Create new PDF instance
  const doc = new jsPDF();
  
  // Add company header
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text(companyName || 'Training Management System', 14, 22);
  
  // Add filters info if any
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  let filterText = 'All Entries';
  
  const campusName = filters.campusName || 'All Campuses';
  const batchName = filters.batchName || 'All Batches';
  
  filterText = `Filtered: ${campusName} - ${batchName}`;
  doc.text(filterText, 14, 32);
  
  // Add date of export
  doc.text(`Exported on: ${new Date().toLocaleDateString()}`, 14, 42);
  
  // Prepare data for the table (PDF/Word: no project column). Use safe date and trainer name fallback.
  const tableData = data.map(entry => {
    // safe date handling
    let dateStr = '';
    if (entry.date && typeof entry.date === 'object' && entry.date.seconds) {
      dateStr = new Date(entry.date.seconds * 1000).toLocaleDateString();
    } else if (entry.date) {
      try { dateStr = new Date(entry.date).toLocaleDateString(); } catch { dateStr = String(entry.date); }
    }

    // Resolve trainer fields with preference to DB name/email over entry fields
    const trainerRef = trainersMap[entry.trainerId] || trainersMap[entry.trainer && entry.trainer.uid] || null;
    const trainerObj = trainerRef || entry.trainer || {};
    const rawTrainerName = entry.trainerName || '';
    const rawTrainerEmail = entry.trainerEmail || '';

    // If older entries stored email in trainerName, detect that
    const trainerNameFromEntry = (rawTrainerName && rawTrainerName.includes('@')) ? '' : rawTrainerName;
    const trainerEmailFromEntry = rawTrainerEmail || (rawTrainerName && rawTrainerName.includes('@') ? rawTrainerName : '');

    const trainerDisplay = trainerObj.name || trainerNameFromEntry || trainerEmailFromEntry || trainerObj.email || 'N/A';

    return [
      dateStr,
      entry.campusName || 'N/A',
      entry.batchName || 'N/A',
      trainerDisplay,
      entry.topic || '',
      entry.subtopic || '',
      entry.hours != null ? String(entry.hours) : '',
      entry.studentCount != null ? String(entry.studentCount) : ''
    ];
  });

  // Add table using autoTable with better column widths
  autoTable(doc, {
    startY: 50,
    head: [['Date', 'Campus', 'Batch', 'Trainer', 'Topic', 'Subtopic', 'Hours', 'Count']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [41, 128, 185],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center'
    },
    bodyStyles: {
      halign: 'center'
    },
    alternateRowStyles: {
      fillColor: [240, 240, 240]
    },
    columnStyles: {
  0: { cellWidth: 22, halign: 'center' }, // Date
  1: { cellWidth: 30, halign: 'center' }, // Campus
  2: { cellWidth: 14, halign: 'center' }, // Batch (shorter)
  3: { cellWidth: 28, halign: 'center' }, // Trainer
  4: { cellWidth: 28, halign: 'center' }, // Topic
  5: { cellWidth: 28, halign: 'center' }, // Subtopic
  6: { cellWidth: 15, halign: 'center' }, // Hours
  7: { cellWidth: 15, halign: 'center' }  // Count
    }
  });
  
  // Save the PDF
  doc.save('training_entries.pdf');
};

export const exportToExcel = (data, filters) => {
  // Format data for Excel (include all fields including Project and trainer email)
  // We'll fetch trainers from DB to ensure name/email are taken from users collection when available
  return (async () => {
    const trainersMap = await fetchTrainersMap();
    const excelData = data.map(entry => {
    let dateStr = '';
    if (entry.date && typeof entry.date === 'object' && entry.date.seconds) {
      dateStr = new Date(entry.date.seconds * 1000).toLocaleDateString();
    } else if (entry.date) {
      try { dateStr = new Date(entry.date).toLocaleDateString(); } catch { dateStr = String(entry.date); }
    }

    const trainerRef = trainersMap[entry.trainerId] || trainersMap[entry.trainer && entry.trainer.uid] || null;
    const trainerObj = trainerRef || entry.trainer || {};
    const rawTrainerName = entry.trainerName || '';
    const rawTrainerEmail = entry.trainerEmail || '';

    // Determine trainer name and email for Excel: prefer DB values, but fallback to entry fields and handle old entries
    let trainerName = trainerObj.name || '';
    let trainerEmail = trainerObj.email || '';

    if (!trainerName && rawTrainerName) {
      if (rawTrainerName.includes('@')) {
        // stored as email in old entries
        trainerEmail = trainerEmail || rawTrainerName;
      } else {
        trainerName = rawTrainerName;
      }
    }

    if (!trainerEmail && rawTrainerEmail) {
      trainerEmail = rawTrainerEmail;
    }

    return {
      Date: dateStr,
      Project: entry.projectName || 'N/A',
      Campus: entry.campusName || 'N/A',
      Batch: entry.batchName || 'N/A',
      'Trainer Name': trainerName,
      'Trainer Email': trainerEmail,
      Topic: entry.topic || '',
      Subtopic: entry.subtopic || '',
      'Start Time': entry.startTime || '',
      'End Time': entry.endTime || '',
      Hours: entry.hours != null ? entry.hours : '',
      'Student Count': entry.studentCount != null ? entry.studentCount : ''
    };
  });
  
    // Create worksheet and workbook
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    // Set column widths to help fit content (approx chars)
    worksheet['!cols'] = [
      { wch: 12 }, // Date
      { wch: 18 }, // Project
      { wch: 14 }, // Campus
      { wch: 10 }, // Batch (shorter)
      { wch: 20 }, // Trainer Name
      { wch: 26 }, // Trainer Email
      { wch: 20 }, // Topic
      { wch: 20 }, // Subtopic
      { wch: 12 }, // Start Time
      { wch: 12 }, // End Time
      { wch: 8 },  // Hours
      { wch: 12 }  // Student Count
    ];

    // Center-align all cells (headers + data)
    try {
      const range = worksheet['!ref'];
      if (range) {
        // iterate all cells in sheet and set alignment style if cell exists
        Object.keys(worksheet).forEach(addr => {
          if (addr[0] === '!') return;
          const cell = worksheet[addr];
          if (!cell.s) cell.s = {};
          if (!cell.s.alignment) cell.s.alignment = {};
          cell.s.alignment.horizontal = 'center';
          cell.s.alignment.vertical = 'center';
        });
      }
  } catch {
      // styling is best-effort; ignore errors
      // console.warn('Could not apply Excel cell styles for alignment', e);
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Training Entries');

    // Generate file name
    const campusName = filters.campusName || 'all';
    const batchName = filters.batchName || 'all';

    const fileName = `training_entries_${campusName}_${batchName}.xlsx`;

    // Save the file
    XLSX.writeFile(workbook, fileName);
  })();
};

export const exportToWord = async (data, filters, companyName) => {
  // fetch trainers map to resolve names/emails
  const trainersMap = await fetchTrainersMap();

  // Create table rows
  const tableRows = [
    new TableRow({
      children: [
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Date', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 10, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Campus', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 15, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Batch', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 15, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Trainer', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 15, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Topic', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 15, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Subtopic', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 15, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Hours', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 8, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
        new TableCell({ 
          children: [new Paragraph({ 
            text: 'Students', 
            style: 'TableHeader',
            alignment: AlignmentType.CENTER
          })], 
          width: { size: 7, type: WidthType.PERCENTAGE },
          shading: { fill: "2B80B9" }
        }),
      ],
      tableHeader: true
    })
  ];

  // Add data rows with alternating colors
  data.forEach((entry, index) => {
    const isEvenRow = index % 2 === 0;
    const rowColor = isEvenRow ? "FFFFFF" : "F0F0F0";
  // resolve trainer display using DB when available
  const trainerRef = trainersMap[entry.trainerId] || trainersMap[entry.trainer && entry.trainer.uid] || null;
  const trainerObj = trainerRef || entry.trainer || {};
  const rawTrainerName = entry.trainerName || '';
  const rawTrainerEmail = entry.trainerEmail || '';
  const trainerNameFromEntry = (rawTrainerName && rawTrainerName.includes('@')) ? '' : rawTrainerName;
  const trainerEmailFromEntry = rawTrainerEmail || (rawTrainerName && rawTrainerName.includes('@') ? rawTrainerName : '');
  const trainerDisplay = trainerObj.name || trainerNameFromEntry || trainerEmailFromEntry || trainerObj.email || 'N/A';

  tableRows.push(
      new TableRow({
        children: [
          new TableCell({ 
              children: [new Paragraph({
          text: (entry.date && entry.date.seconds) ? new Date(entry.date.seconds * 1000).toLocaleDateString() : (entry.date ? new Date(entry.date).toLocaleDateString() : ''),
                alignment: AlignmentType.CENTER
              })],
              shading: { fill: rowColor }
            }),
          new TableCell({ 
            children: [new Paragraph({
              text: entry.campusName || 'N/A',
              alignment: AlignmentType.CENTER
            })],
            shading: { fill: rowColor }
          }),
          new TableCell({ 
            children: [new Paragraph({
              text: entry.batchName || 'N/A',
              alignment: AlignmentType.CENTER
            })],
            shading: { fill: rowColor }
          }),
          new TableCell({ 
            children: [new Paragraph({
              text: trainerDisplay,
              alignment: AlignmentType.CENTER
            })],
            shading: { fill: rowColor }
          }),
          new TableCell({ 
            children: [new Paragraph({
              text: entry.topic || '',
              alignment: AlignmentType.CENTER
            })],
            shading: { fill: rowColor }
          }),
          new TableCell({ 
            children: [new Paragraph({
              text: entry.subtopic || '',
              alignment: AlignmentType.CENTER
            })],
            shading: { fill: rowColor }
          }),
          new TableCell({ 
            children: [new Paragraph({
              text: entry.hours != null ? String(entry.hours) : '',
              alignment: AlignmentType.CENTER
            })],
            shading: { fill: rowColor }
          }),
          new TableCell({ 
            children: [new Paragraph({
              text: entry.studentCount != null ? String(entry.studentCount) : '',
              alignment: AlignmentType.CENTER
            })],
            shading: { fill: rowColor }
          }),
        ]
      })
    );
  });

  // Create the document with styles
  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            size: 32,
            bold: true,
            color: "282828",
          },
          paragraph: {
            spacing: {
              after: 120,
            },
          },
        },
        {
          id: "TableHeader",
          name: "Table Header",
          basedOn: "Normal",
          next: "Normal",
          run: {
            color: "FFFFFF",
            bold: true,
          },
        },
        {
          id: "FilterText",
          name: "Filter Text",
          basedOn: "Normal",
          next: "Normal",
          run: {
            color: "646464",
            size: 22,
          },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          margin: {
            top: 720,
            right: 720,
            bottom: 720,
            left: 720,
          },
        },
      },
      children: [
        new Paragraph({
          text: companyName || 'Training Management System',
          style: "Heading1",
        }),
        new Paragraph({
          text: `Filtered: ${filters.campusName || 'All Campuses'} - ${filters.batchName || 'All Batches'}`,
          style: "FilterText",
        }),
        new Paragraph({
          text: `Exported on: ${new Date().toLocaleDateString()}`,
          style: "FilterText",
        }),
        new Paragraph({ text: "" }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows,
          borders: {
            all: {
              style: "single",
              size: 1,
              color: "DDDDDD",
            },
          },
          layout: {
            type: "fixed" // This ensures consistent column widths
          }
        }),
      ],
    }],
  });

  // Generate the blob and download
  const blob = await Packer.toBlob(doc);
  
  // Generate file name
  const campusName = filters.campusName || 'all';
  const batchName = filters.batchName || 'all';
  
  saveAs(blob, `training_entries_${campusName}_${batchName}.docx`);
};

/* ==========================================================================
   CLOSURE REPORT
   ========================================================================== */

const BLUE_RGB = [47, 84, 150];
const BLUE_HEX = '2F5597';
const LIGHT_BLUE_RGB = [217, 225, 242];
const LIGHT_BLUE_HEX = 'D9E1F2';
const GREY_RGB = [240, 240, 240];
const GREY_HEX = 'F0F0F0';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
};

// "YYYY-MM-DD" (from <input type="date">) -> local Date
export const parseInputDate = (str) => {
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d);
};

// 5th August 2026
const formatOrdinalDate = (d) => `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// August 05, 2026
const formatTableDate = (d) =>
  d ? `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}` : '-';

// Firestore Timestamp / Date / string -> JS Date (or null)
export const entryDateToJS = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'object' && value.seconds != null) return new Date(value.seconds * 1000);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

// round to 2 decimals to avoid float artifacts (7.000000001)
const fmtHours = (n) => String(Math.round((Number(n) || 0) * 100) / 100);

const safeFilePart = (s) =>
  String(s || '').trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const resolveTrainerName = (entry, trainersMap) => {
  const trainerRef = trainersMap[entry.trainerId] || trainersMap[entry.trainer && entry.trainer.uid] || null;
  const trainerObj = trainerRef || entry.trainer || {};
  const rawTrainerName = entry.trainerName || '';
  const rawTrainerEmail = entry.trainerEmail || '';
  const nameFromEntry = rawTrainerName && rawTrainerName.includes('@') ? '' : rawTrainerName;
  const emailFromEntry = rawTrainerEmail || (rawTrainerName && rawTrainerName.includes('@') ? rawTrainerName : '');
  return trainerObj.name || nameFromEntry || emailFromEntry || trainerObj.email || 'N/A';
};

// Group entries by batch and aggregate hours by topic
/* ----------------------------- FORMATS ---------------------------------- */

export const CLOSURE_FORMATS = {
  BATCH: 'batch',     // one table per batch
  TRAINER: 'trainer', // one table per trainer
  DATE: 'date'        // one table per date
};

const isValidDate = (d) => d instanceof Date && !isNaN(d.getTime());
const timeOf = (d) => (isValidDate(d) ? d.getTime() : Infinity);
// Oldest first, missing/invalid dates last
const cmpTime = (a, b) => {
  const at = timeOf(a);
  const bt = timeOf(b);
  return at === bt ? 0 : at < bt ? -1 : 1;
};
const cmpText = (a, b) => String(a).localeCompare(String(b));
const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const uniqSorted = (arr) => Array.from(new Set(arr)).sort(cmpText);

// PDF widths in mm (sum 182) / Word widths in twips (sum 10466)
const FORMAT_CONFIG = {
  batch: {
    head: ['Date', 'Trainer', 'Domain', 'Topics Covered', 'Students'],
    pdfColW: [28, 32, 28, 74, 20],
    wordColW: [1700, 2000, 1700, 4166, 900],
    groupKey: (r) => r.batchKey,
    groupName: (r) => r.batchName,
    title: (g) => `Batch - ${g.name}`,
    subtitle: (g) => ({ label: 'Trainers:', value: uniqSorted(g.records.map((r) => r.trainer)).join(', ') || '-' }),
    rowSort: (a, b) => cmpTime(a.date, b.date),
    row: (r) => [formatTableDate(r.date), r.trainer, r.domain, r.topics, r.students]
  },
  trainer: {
    head: ['Date', 'Batch', 'Domain', 'Topics Covered', 'Students'],
    pdfColW: [28, 32, 28, 74, 20],
    wordColW: [1700, 2000, 1700, 4166, 900],
    groupKey: (r) => r.trainer,
    groupName: (r) => r.trainer,
    title: (g) => `Trainer - ${g.name}`,
    subtitle: (g) => ({ label: 'Batches:', value: uniqSorted(g.records.map((r) => r.batchName)).join(', ') || '-' }),
    rowSort: (a, b) => cmpTime(a.date, b.date) || cmpText(a.batchName, b.batchName),
    row: (r) => [formatTableDate(r.date), r.batchName, r.domain, r.topics, r.students]
  },
  date: {
    head: ['Batch', 'Trainer', 'Domain', 'Topics Covered', 'Students'],
    pdfColW: [32, 32, 28, 70, 20],
    wordColW: [2000, 2000, 1700, 3866, 900],
    groupKey: (r) => (isValidDate(r.date) ? dayKey(r.date) : 'no-date'),
    groupName: (r) => (isValidDate(r.date) ? formatTableDate(r.date) : 'No Date'),
    title: (g) => g.name,
    subtitle: null,
    rowSort: (a, b) => cmpText(a.batchName, b.batchName) || cmpText(a.trainer, b.trainer),
    row: (r) => [r.batchName, r.trainer, r.domain, r.topics, r.students]
  }
};

/* ------------------------------ DATA ------------------------------------ */

// Normalise raw entries once; every format is built from these records.
const buildRecords = (entries, trainersMap) =>
  entries.map((entry) => {
    const hasStudents = entry.studentCount != null && entry.studentCount !== '';
    return {
      date: entryDateToJS(entry.date),
      batchKey: entry.batchId || entry.batchName || 'unknown',
      batchName: entry.batchName || 'N/A',
      trainer: resolveTrainerName(entry, trainersMap),
      domain: (entry.topic || '').trim() || 'Other',
      topics: entry.subtopic || entry.description || '-',
      students: hasStudents ? String(entry.studentCount) : '-'
      // POA (disabled)
      // hours: Number(entry.hours) || 0,
    };
  });

// Groups records and orders the groups by their earliest date (oldest first).
// Groups with no valid date go last; ties fall back to name.
const groupRecords = (records, keyFn, nameFn) => {
  const map = new Map();
  records.forEach((r) => {
    const key = keyFn(r);
    if (!map.has(key)) map.set(key, { id: key, name: nameFn(r), records: [], firstDate: null });
    const g = map.get(key);
    g.records.push(r);
    if (isValidDate(r.date) && (!g.firstDate || r.date.getTime() < g.firstDate.getTime())) {
      g.firstDate = r.date;
    }
  });
  return Array.from(map.values()).sort((a, b) => cmpTime(a.firstDate, b.firstDate) || cmpText(a.name, b.name));
};

const buildClosureReportData = (entries, trainersMap, format = CLOSURE_FORMATS.BATCH) => {
  const cfg = FORMAT_CONFIG[format] || FORMAT_CONFIG.batch;
  const records = buildRecords(entries, trainersMap);

  const groups = groupRecords(records, cfg.groupKey, cfg.groupName).map((g) => {
    g.records.sort(cfg.rowSort);
    return {
      id: g.id,
      name: g.name, // key used by meta.batchBreaks
      title: cfg.title(g),
      subtitle: cfg.subtitle ? cfg.subtitle(g) : null, // { label, value } or null
      rows: g.records.map(cfg.row)
    };
  });

  return { groups, head: cfg.head, pdfColW: cfg.pdfColW, wordColW: cfg.wordColW };
};

// POA (disabled): summary table data (hours per topic per batch).
// To re-enable: uncomment `hours` in buildRecords, build batch groups with
// groupRecords(records, FORMAT_CONFIG.batch.groupKey, FORMAT_CONFIG.batch.groupName)
// and spread the result of this function into the object returned above.
// const buildPoaSummary = (records, batchGroups) => {
//   const topics = uniqSorted(records.map((r) => r.domain));
//   const hours = (g, t) =>
//     records.filter((r) => r.batchKey === g.id && r.domain === t).reduce((s, r) => s + r.hours, 0);
//   const total = (g) => records.filter((r) => r.batchKey === g.id).reduce((s, r) => s + r.hours, 0);
//   const summaryHead = ['POA', ...batchGroups.map((g) => g.name)];
//   const summaryBody = topics.map((t) => [t, ...batchGroups.map((g) => fmtHours(hours(g, t)))]);
//   summaryBody.push(['Total', ...batchGroups.map((g) => fmtHours(total(g)))]);
//   return { topics, summaryHead, summaryBody };
// };

// POA (disabled)
// const buildPoaLine = (meta) =>
//   `POA (${formatOrdinalDate(parseInputDate(meta.startDate))} - ${formatOrdinalDate(parseInputDate(meta.endDate))})`;

const buildFileBase = (meta) => {
  const parts = ['Closure_Report', safeFilePart(meta.projectName)];
  if (meta.campusName) parts.push(safeFilePart(meta.campusName));
  if (meta.format === CLOSURE_FORMATS.TRAINER) parts.push('By_Trainer');
  if (meta.format === CLOSURE_FORMATS.DATE) parts.push('By_Date');
  return parts.filter(Boolean).join('_');
};

/* ------------------------------- PDF ------------------------------------ */
// POA (disabled)
// const pdfSummaryFontSize = (n) => {
//   if (n <= 4) return 10;
//   if (n <= 6) return 9;
//   if (n <= 8) return 8;
//   if (n <= 10) return 7;
//   return 6;
// };

const renderClosurePDF = (report, meta) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const usable = pageW - margin * 2;
  const PT_TO_MM = 0.3528;
  const MIN_SPACE_FOR_BATCH = 60; // mm needed for title + subtitle + header + 1 row

  let y = 25; // was 45 when page 1 was a cover page for the POA table
  const centered = (text, size, style, color, gap) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text), usable);
    doc.text(lines, pageW / 2, y, { align: 'center' });
    y += lines.length * size * PT_TO_MM * 1.25 + gap;
  };

  // ---- Page 1: headers ----
  centered(meta.companyName || 'Company Name', 24, 'bold', [40, 40, 40], 4);
  centered('Closure Report', 20, 'bold', BLUE_RGB, 6);
  centered(meta.projectName || '', 14, 'normal', [60, 60, 60], 4);
  // POA (disabled)
  // centered(buildPoaLine(meta), 12, 'normal', [90, 90, 90], 10);

  // ---- Page 1: POA summary table (disabled) ----
  // const n = report.batches.length;
  // const fs = pdfSummaryFontSize(n);
  // const firstColW = Math.min(55, usable * 0.3);
  // const otherColW = (usable - firstColW) / Math.max(n, 1);
  // const summaryColumnStyles = { 0: { cellWidth: firstColW, fontStyle: 'bold' } };
  // for (let i = 1; i <= n; i++) summaryColumnStyles[i] = { cellWidth: otherColW };
  // const totalRowIndex = report.summaryBody.length - 1;
  //
  // autoTable(doc, {
  //   startY: y,
  //   head: [report.summaryHead],
  //   body: report.summaryBody,
  //   theme: 'grid',
  //   tableWidth: usable,
  //   margin: { top: 20, left: margin, right: margin },
  //   styles: {
  //     fontSize: fs,
  //     halign: 'center',
  //     valign: 'middle',
  //     overflow: 'linebreak',
  //     lineColor: [200, 200, 200],
  //     lineWidth: 0.1,
  //     cellPadding: 2.5
  //   },
  //   headStyles: { fillColor: BLUE_RGB, textColor: 255, fontStyle: 'bold' },
  //   alternateRowStyles: { fillColor: GREY_RGB },
  //   columnStyles: summaryColumnStyles,
  //   didParseCell: (data) => {
  //     if (data.section === 'body' && data.row.index === totalRowIndex) {
  //       data.cell.styles.fillColor = LIGHT_BLUE_RGB;
  //       data.cell.styles.fontStyle = 'bold';
  //     }
  //   }
  // });

  const columnStyles = Object.fromEntries(report.pdfColW.map((w, i) => [i, { cellWidth: w }]));

  // ---- Group tables (batch / trainer / date) ----
  report.groups.forEach((group, idx) => {
    // The first group now sits on page 1 under the header.
    // Others follow meta.batchBreaks[group.name]; default is a new page.
    let startNewPage = idx === 0 ? false : (meta.batchBreaks?.[group.name] ?? true);
    let by;

    if (!startNewPage) {
      by = idx === 0 ? y + 4 : doc.lastAutoTable.finalY + 12;
      // Not enough room left on this page -> fall back to a new page
      if (by > pageH - MIN_SPACE_FOR_BATCH) startNewPage = true;
    }
    if (startNewPage) {
      doc.addPage();
      by = 22;
    }

    // Title (blue)
    doc.setFontSize(16);
    doc.setTextColor(...BLUE_RGB);
    doc.setFont('helvetica', 'bold');

    const titleLines = doc.splitTextToSize(group.title, usable);
    doc.text(titleLines, pageW / 2, by, { align: 'center' });
    by += titleLines.length * 16 * PT_TO_MM * 1.25 + 3;

    // Subtitle: (bold) label + value, e.g. "Trainers: A, B" (skipped for date tables)
    if (group.subtitle) {
      doc.setFontSize(12);
      doc.setTextColor(30, 30, 30);
      const label = group.subtitle.label;

      doc.setFont('helvetica', 'bold');
      const labelW = doc.getTextWidth(label) + 2;

      doc.setFont('helvetica', 'normal');
      const subLines = doc.splitTextToSize(group.subtitle.value, usable - labelW);

      const firstLineW = doc.getTextWidth(subLines[0]);
      const startX = (pageW - (labelW + firstLineW)) / 2;

      doc.setFont('helvetica', 'bold');
      doc.text(label, startX, by);

      doc.setFont('helvetica', 'normal');
      doc.text(subLines[0], startX + labelW, by);

      for (let i = 1; i < subLines.length; i++) {
        doc.text(subLines[i], pageW / 2, by + i * 12 * PT_TO_MM * 1.3, { align: 'center' });
      }
      by += subLines.length * 12 * PT_TO_MM * 1.3 + 4;
    } else {
      by += 2;
    }

    autoTable(doc, {
      startY: by,
      head: [report.head],
      body: group.rows,
      theme: 'grid',
      tableWidth: usable,
      margin: { top: 20, left: margin, right: margin },
      styles: {
        fontSize: 9,
        halign: 'center',
        valign: 'middle',
        overflow: 'linebreak',
        lineColor: [200, 200, 200],
        lineWidth: 0.1,
        cellPadding: 3
      },
      headStyles: { fillColor: BLUE_RGB, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: GREY_RGB },
      columnStyles,
      showHead: 'everyPage'
    });
  });

  doc.save(`${buildFileBase(meta)}.pdf`);
};

/* ------------------------------- WORD ----------------------------------- */

const WORD_PAGE_W = 11906; // A4 portrait (twips)
const WORD_PAGE_H = 16838;
const WORD_MARGIN = 720;
const WORD_CONTENT_W = WORD_PAGE_W - WORD_MARGIN * 2; // 10466

// POA (disabled)
// const wordSummaryFontSize = (n) => {
//   // half-points
//   if (n <= 4) return 20;
//   if (n <= 6) return 18;
//   if (n <= 8) return 16;
//   if (n <= 10) return 14;
//   return 12;
// };

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const tableBorders = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
  insideHorizontal: thinBorder,
  insideVertical: thinBorder
};

const wCell = (text, { width, bold = false, color = '000000', fill, size = 20, align = AlignmentType.CENTER } = {}) =>
  new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: align,
        children: [new TextRun({ text: String(text), bold, color, size })]
      })
    ]
  });

const centeredPara = (text, { size, bold = false, color = '000000', before = 0, after = 120 }) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before, after },
    children: [new TextRun({ text: String(text), bold, color, size })]
  });

const renderClosureWord = async (report, meta) => {
  const children = [];
  const spacer = () => new Paragraph({ spacing: { before: 0, after: 0 }, children: [] });

  // ---- Page 1: headers ----
  // before was 1800 when page 1 was a cover page for the POA table
  children.push(centeredPara(meta.companyName || 'Company Name', { size: 48, bold: true, color: '282828', before: 400, after: 160 }));
  children.push(centeredPara('Closure Report', { size: 40, bold: true, color: BLUE_HEX, after: 200 }));
  children.push(centeredPara(meta.projectName || '', { size: 28, color: '3C3C3C', after: 120 }));
  // POA (disabled)
  // children.push(centeredPara(buildPoaLine(meta), { size: 24, color: '5A5A5A', after: 400 }));

  // ---- Page 1: POA summary table (disabled) ----
  // const n = Math.max(report.batches.length, 1);
  // const fs = wordSummaryFontSize(report.batches.length);
  // const firstW = Math.max(1800, Math.min(3000, Math.floor(WORD_CONTENT_W * 0.28)));
  // const otherW = Math.floor((WORD_CONTENT_W - firstW) / n);
  // const tableW = firstW + otherW * n;
  // const colWidths = [firstW, ...Array(n).fill(otherW)];
  // const totalRowIndex = report.summaryBody.length - 1;
  //
  // const summaryRows = [
  //   new TableRow({
  //     tableHeader: true,
  //     cantSplit: true,
  //     children: report.summaryHead.map((h, i) =>
  //       wCell(h, { width: colWidths[i], bold: true, color: 'FFFFFF', fill: BLUE_HEX, size: fs })
  //     )
  //   }),
  //   ...report.summaryBody.map((row, rIdx) => {
  //     const isTotal = rIdx === totalRowIndex;
  //     const fill = isTotal ? LIGHT_BLUE_HEX : rIdx % 2 === 1 ? GREY_HEX : 'FFFFFF';
  //     return new TableRow({
  //       cantSplit: true,
  //       children: row.map((val, i) =>
  //         wCell(val, { width: colWidths[i], bold: isTotal || i === 0, fill, size: fs })
  //       )
  //     });
  //   })
  // ];
  //
  // children.push(
  //   new Table({
  //     width: { size: tableW, type: WidthType.DXA },
  //     columnWidths: colWidths,
  //     layout: TableLayoutType.FIXED,
  //     borders: tableBorders,
  //     alignment: AlignmentType.CENTER,
  //     rows: summaryRows
  //   })
  // );
  // children.push(spacer()); // gap after the summary table

  // ---- Group sections (batch / trainer / date) ----
  const colW = report.wordColW;

  report.groups.forEach((group, idx) => {
    // The first group now sits on page 1 under the header.
    // Others follow meta.batchBreaks[group.name]; default is a new page.
    const startNewPage = idx === 0 ? false : (meta.batchBreaks?.[group.name] ?? true);

    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        spacing: { before: startNewPage ? 0 : 240, after: group.subtitle ? 120 : 200 },
        children: [
          // A real, visible page-break character the admin can delete in Word
          ...(startNewPage ? [new PageBreak()] : []),
          new TextRun({ text: group.title, bold: true, color: BLUE_HEX, size: 32 })
        ]
      })
    );

    if (group.subtitle) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          alignment: AlignmentType.CENTER,
          keepNext: true,
          spacing: { before: 0, after: 200 },
          children: [
            new TextRun({ text: `${group.subtitle.label} `, bold: true, color: '1E1E1E', size: 24 }),
            new TextRun({ text: group.subtitle.value, bold: false, color: '1E1E1E', size: 24 })
          ]
        })
      );
    }

    const rows = [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: report.head.map((h, i) =>
          wCell(h, { width: colW[i], bold: true, color: 'FFFFFF', fill: BLUE_HEX, size: 20 })
        )
      }),
      ...group.rows.map((cells, rIdx) => {
        const fill = rIdx % 2 === 0 ? GREY_HEX : 'FFFFFF';
        return new TableRow({
          cantSplit: true,
          children: cells.map((c, i) => wCell(c, { width: colW[i], fill, size: 20 }))
        });
      })
    ];

    children.push(
      new Table({
        width: { size: WORD_CONTENT_W, type: WidthType.DXA },
        columnWidths: colW,
        layout: TableLayoutType.FIXED,
        borders: tableBorders,
        rows
      })
    );

    // Free paragraph after every table so the next group can be moved freely
    children.push(spacer());
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: WORD_PAGE_W, height: WORD_PAGE_H },
            margin: { top: WORD_MARGIN, right: WORD_MARGIN, bottom: WORD_MARGIN, left: WORD_MARGIN }
          }
        },
        children
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${buildFileBase(meta)}.docx`);
};

/* ------------------------------ EXPORTS --------------------------------- */
// meta.format: 'batch' (default) | 'trainer' | 'date'

export const exportClosureReportPDF = async (entries, meta) => {
  const trainersMap = await fetchTrainersMap();
  renderClosurePDF(buildClosureReportData(entries, trainersMap, meta.format), meta);
};

export const exportClosureReportWord = async (entries, meta) => {
  const trainersMap = await fetchTrainersMap();
  await renderClosureWord(buildClosureReportData(entries, trainersMap, meta.format), meta);
};

// Builds the data once and downloads both files
export const exportClosureReport = async (entries, meta) => {
  const trainersMap = await fetchTrainersMap();
  const report = buildClosureReportData(entries, trainersMap, meta.format);
  renderClosurePDF(report, meta);
  await renderClosureWord(report, meta);
};