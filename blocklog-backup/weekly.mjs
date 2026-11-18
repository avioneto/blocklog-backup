// Blocklog weekly backup: reads your data from Supabase, builds the EASA PDF (no signature), the flights CSV and the JSON backup,
// and emails them to you through Resend. Runs in GitHub Actions (see README.md). The app code is downloaded from your own site, so the PDF always matches the app.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const env = k => (process.env[k] || '').trim();
const need = k => { const v = env(k); if (!v) throw new Error(`Missing secret ${k}`); return v; };
const DRY = env('DRY_RUN') === '1';
const SUPA = (env('SUPABASE_URL') || 'https://gwcqftzogbxnfekotlhy.supabase.co').replace(/\/$/, '');
const KEY = env('SUPABASE_KEY') || 'sb_publishable_W5JGEF_j-htQ1GHoQ4xcNA_5rRXN_R-';
const APP = need('APP_URL').replace(/\/$/, '');
const FILES = ['flightlogic.js', 'dashlogic.js', 'exportlogic.js', 'exportpdf.js', 'backuplogic.js', 'pdf-lib.min.mjs'];
const STORES = ['airports', 'aircraft_types', 'aircraft', 'crew', 'flights', 'fstd_sessions', 'documents'];

async function loadApp() {
  const dir = join(tmpdir(), 'blocklog-app'); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"type":"module"}');
  for (const f of FILES) {
    const r = await fetch(`${APP}/${f}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`Could not download ${f} from ${APP} (${r.status})`);
    await writeFile(join(dir, f), Buffer.from(await r.arrayBuffer()));
  }
  const m = f => import(pathToFileURL(join(dir, f)).href);
  return { logic: await m('exportlogic.js'), pdf: await m('exportpdf.js'), bk: await m('backuplogic.js'), dash: await m('dashlogic.js'), L: await m('pdf-lib.min.mjs') };
}

async function readData() {
  if (env('DATA_FILE')) return JSON.parse(await readFile(env('DATA_FILE'), 'utf8')).data; // test mode
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: need('BLOCKLOG_EMAIL'), password: need('BLOCKLOG_PASSWORD') }) });
  const j = await r.json(); if (!r.ok) throw new Error('Sign in failed: ' + (j.error_description || j.msg || r.status));
  const h = { apikey: KEY, Authorization: `Bearer ${j.access_token}` }, data = {};
  for (const s of STORES) {
    data[s] = [];
    for (let from = 0; ; from += 1000) {
      const q = await fetch(`${SUPA}/rest/v1/${s}?select=*&deleted=eq.false&order=id.asc&limit=1000&offset=${from}`, { headers: h });
      if (!q.ok) throw new Error(`Could not read ${s}: ${await q.text()}`);
      const rows = await q.json(); data[s].push(...rows); if (rows.length < 1000) break;
    }
  }
  return data;
}

const { logic, pdf, bk, dash, L } = await loadApp();
const data = await readData(), today = new Date().toISOString().slice(0, 10);
const reg = Object.fromEntries((data.aircraft || []).map(a => [a.id, a.registration]));
const csv = bk.flightsCsv(data.flights, f => f.locked ? f.reg_snap : (reg[f.aircraft_id] || f.reg_snap));
const json = JSON.stringify(bk.makeBackup(data, {}, { created: new Date().toISOString(), app: 'blocklog', email: env('BLOCKLOG_EMAIL') || null, signature: null }));
const flown = data.flights.filter(f => f.locked);
let attachments = [
  { filename: `Blocklog_flights_${today}.csv`, content: Buffer.from(csv, 'utf8').toString('base64') },
  { filename: `Blocklog_backup_${today}.json`, content: Buffer.from(json, 'utf8').toString('base64') }
];
let pdfNote = '';
if (flown.length) {
  const d = logic.buildPages(data.flights, dash.range('all', dash.today(), {}), data.fstd_sessions);
  const bytes = await pdf.makePdf(L, d, { name: env('PILOT_NAME'), signature: null });
  attachments.unshift({ filename: `Blocklog_EASA_Logbook_${d.from}_${d.to}.pdf`, content: Buffer.from(bytes).toString('base64') });
  pdfNote = ` ${d.pages.length} sheets (A and B) in the PDF, without signature.`;
} else pdfNote = ' No flown flights yet, so no PDF.';
const size = attachments.reduce((n, a) => n + a.content.length * 0.75, 0);
console.log(`flights ${data.flights.length} (flown ${flown.length}), attachments ${attachments.map(a => a.filename).join(', ')}, ${(size / 1048576).toFixed(2)} MB`);
if (size > 35 * 1048576) throw new Error('The attachments are too large for one email.');
if (DRY) { for (const a of attachments) await writeFile(join(env('OUT_DIR') || tmpdir(), a.filename), Buffer.from(a.content, 'base64')); console.log('Dry run: nothing sent.'); process.exit(0); }
const to = env('MAIL_TO') || need('BLOCKLOG_EMAIL');
const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${need('RESEND_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
  from: env('MAIL_FROM') || 'Blocklog <onboarding@resend.dev>', to: [to], subject: `Blocklog weekly backup ${today}`,
  text: `Your weekly Blocklog backup (${today}).\n\n${data.flights.length} flights (${flown.length} flown), ${(data.fstd_sessions || []).length} simulator sessions.${pdfNote}\n\nThe .json file can be restored in the app: Data & Settings > Backup > Restore from backup file (it does not contain document files or the signature).`,
  attachments }) });
const out = await r.text(); if (!r.ok) throw new Error(`Resend error ${r.status}: ${out}`);
console.log('Email sent to', to, out);
