import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// "John  Doe/Jr." -> "John_DoeJr"  (safe to use as part of a file name)
export const safeName = (s) =>
  String(s || 'trainer')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_') || 'trainer';

const pad = (n) => String(n).padStart(2, '0');

// Date -> "02/10/2026" (day/month/year, same on every browser and locale)
const formatDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

const dateText = (value) => {
  if (!value) return '';
  // Firestore Timestamp ({ seconds }) or anything `new Date()` understands
  const d = typeof value === 'object' && value.seconds ? new Date(value.seconds * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : formatDate(d);
};

// Older entries hold one "subtopic" text, newer ones a "lessons" list
const subtopicText = (entry) =>
  entry.subtopic || (Array.isArray(entry.lessons) ? entry.lessons.join(', ') : '');

/**
 * Entries PDF for ONE trainer. Returns the PDF as bytes (nothing is downloaded).
 * meta = { trainerName }
 *
 * Header: Entries / Trainer / Total Hours / Topic (unique values)
 * Table : Date, Batch, Subtopic, Hours, Count
 */
export const buildTrainerEntriesPdf = (entries, meta = {}) => {
  const doc = new jsPDF();
  const maxWidth = 182; // A4 width (210) minus 14 margin on each side

  // total of the Hours column (rounded to 2 decimals, no trailing zeros)
  const totalHours = Math.round(entries.reduce((sum, e) => sum + (Number(e.hours) || 0), 0) * 100) / 100;

  // each topic once, in the order it first appears
  const topics = [...new Set(entries.map((e) => String(e.topic || '').trim()).filter(Boolean))];

  // Title
  doc.setFontSize(20);
  doc.setTextColor(40, 40, 40);
  doc.text('Entries', 14, 22);

  // Details
  doc.setFontSize(12);
  doc.setTextColor(100, 100, 100);
  doc.text(`Trainer: ${meta.trainerName || 'N/A'}`, 14, 32);
  doc.text(`Total Hours: ${totalHours}`, 14, 40);

  // Topic line can be long, so wrap it and move the table down by however many lines it takes
  const topicLines = doc.splitTextToSize(`Topic: ${topics.join(', ') || 'N/A'}`, maxWidth);
  doc.text(topicLines, 14, 48);
  const lineHeight = doc.getLineHeight() / doc.internal.scaleFactor;
  const y = 48 + topicLines.length * lineHeight;

  const body = entries.map((entry) => [
    dateText(entry.date),
    entry.batchName || 'N/A',
    subtopicText(entry),
    entry.hours != null ? String(entry.hours) : '',
    entry.studentCount != null ? String(entry.studentCount) : '',
  ]);

  autoTable(doc, {
    startY: y + 4,
    head: [['Date', 'Batch', 'Subtopic', 'Hours', 'Count']],
    body,
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: 'bold', halign: 'center' },
    bodyStyles: { halign: 'center' },
    alternateRowStyles: { fillColor: [240, 240, 240] },
    columnStyles: {
      0: { cellWidth: 28, halign: 'center' },
      1: { cellWidth: 30, halign: 'center' },
      2: { cellWidth: 80, halign: 'center' },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 22, halign: 'center' },
    },
  });

  return new Uint8Array(doc.output('arraybuffer'));
};

// Joins PDFs in the order given (first one comes first)
export const mergePdfs = async (pdfBytesList) => {
  const merged = await PDFDocument.create();
  for (const bytes of pdfBytesList) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save(); // Uint8Array
};

// files = [{ name: 'John_merged.pdf', bytes: Uint8Array }]
export const downloadZip = async (files, zipName = 'trainer_invoices.zip') => {
  const zip = new JSZip();
  files.forEach((f) => zip.file(f.name, f.bytes));
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, zipName);
};