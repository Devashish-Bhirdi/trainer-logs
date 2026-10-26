// Self-hosted replacement for Vercel.
// Serves the built React app (dist/) and the /api/send-trainer-schedule endpoint.
//
// Run:   node --env-file=.env server.js        (Node 20.6+)
//   or:  npm install dotenv, then node server.js (uses the import below)

import 'dotenv/config'; // must stay first: the handler reads process.env on import
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import handler from './api/send-trainer-schedule.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT) || 3000;

const app = express();

// Lets the handler's req.body work (same as Vercel did)
app.use(express.json({ limit: '2mb' }));

// Simple check that the server is up
app.get('/health', (_req, res) => res.json({ ok: true }));

// The email endpoint (handles POST and OPTIONS itself)
app.all('/api/send-trainer-schedule', (req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    console.error('Unhandled API error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  });
});

// Unknown /api routes return JSON, not the React page
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Built frontend
app.use(express.static(distDir));

// Client-side routing: send every other request to index.html
app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  if (!process.env.RESEND_API_KEY) {
    console.warn('Warning: RESEND_API_KEY is not set. Emails will fail.');
  }
});