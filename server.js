// Self-hosted replacement for Vercel.
// Serves the built React app (dist/) and every file in api/ as /api/<file-name>.
//
// Run:   node --env-file=.env server.js        (Node 20.6+)
//   or:  npm install dotenv, then node server.js (uses the import below)

import 'dotenv/config'; // must stay first: api files read process.env on import
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const apiDir = path.join(__dirname, 'api');
const port = Number(process.env.PORT) || 3000;

const app = express();

// Makes req.body work (Vercel did this for you)
app.use(express.json({ limit: '2mb' }));

// Simple check that the server is up
app.get('/health', (_req, res) => res.json({ ok: true }));

// Mount every api/<name>.js that has a default-exported function at /api/<name>
// (same as Vercel). Adding a new file to api/ needs a server restart.
const files = fs
  .readdirSync(apiDir)
  .filter((f) => /\.(js|mjs)$/.test(f) && !f.startsWith('_'));

for (const file of files) {
  const name = file.replace(/\.(js|mjs)$/, '');

  try {
    const mod = await import(pathToFileURL(path.join(apiDir, file)).href);

    if (typeof mod.default !== 'function') {
      console.warn(`Skipped api/${file}: no default export function.`);
      continue;
    }

    app.all(`/api/${name}`, (req, res) => {
      Promise.resolve(mod.default(req, res)).catch((error) => {
        console.error(`Unhandled error in /api/${name}:`, error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error.' });
        }
      });
    });

    console.log(`Mounted /api/${name}`);
  } catch (error) {
    console.error(`Could not load api/${file}:`, error);
  }
}

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