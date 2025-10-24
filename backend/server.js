import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data.db';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const app = express();
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json());

const writeLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const likeLimiter = rateLimit({ windowMs: 60_000, max: 60 });

db.exec(`
CREATE TABLE IF NOT EXISTS spots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  notes TEXT,
  tags TEXT,
  hours TEXT,
  likes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'approved',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS likes (
  spot_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  liked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (spot_id, fingerprint),
  FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function rowToSpot(row){
  return {
    id: row.id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    notes: row.notes,
    tags: row.tags ? JSON.parse(row.tags) : [],
    hours: row.hours ? JSON.parse(row.hours) : undefined,
    likes: row.likes
  };
}

function getFingerprint(req){
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const ua = (req.headers['user-agent'] || '').toString();
  return ip + '|' + ua.slice(0, 64);
}

const SpotSubmission = z.object({
  name: z.string().min(2).max(80),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string()).max(12).optional().default([]),
  hours: z.record(z.string(), z.array(z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/)
  }))).optional()
});

// health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// list approved spots
app.get('/api/spots', (req, res) => {
  const rows = db.prepare(`SELECT * FROM spots WHERE status='approved'`).all();
  res.json(rows.map(rowToSpot));
});

// get one
app.get('/api/spots/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM spots WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(rowToSpot(row));
});

// like (idempotent)
app.post('/api/spots/:id/like', likeLimiter, (req, res) => {
  const id = req.params.id;
  const spot = db.prepare(`SELECT * FROM spots WHERE id=? AND status='approved'`).get(id);
  if (!spot) return res.status(404).json({ error: 'Spot not found' });

  const fp = getFingerprint(req);
  const exists = db.prepare(`SELECT 1 FROM likes WHERE spot_id=? AND fingerprint=?`).get(id, fp);
  if (exists) {
    return res.json({ ok: true, liked: true, likes: spot.likes });
  }
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO likes (spot_id, fingerprint) VALUES (?, ?)`).run(id, fp);
    db.prepare(`UPDATE spots SET likes=likes+1 WHERE id=?`).run(id);
    return db.prepare(`SELECT likes FROM spots WHERE id=?`).get(id).likes;
  });
  const total = tx();
  res.json({ ok: true, liked: true, likes: total });
});

// submit new spot (pending)
app.post('/api/spots', writeLimiter, (req, res) => {
  const parsed = SpotSubmission.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
  }
  const subId = nanoid(12);
  const payload = parsed.data;

  db.prepare(`INSERT INTO submissions (id, payload, status) VALUES (?, ?, 'pending')`)
    .run(subId, JSON.stringify(payload));

  const spotId = nanoid(10);
  db.prepare(`INSERT INTO spots (id, name, lat, lng, notes, tags, hours, status) 
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .run(spotId, payload.name, payload.lat, payload.lng, payload.notes || null, JSON.stringify(payload.tags || []), payload.hours ? JSON.stringify(payload.hours) : null);

  res.status(202).json({ ok: true, id: spotId, submission_id: subId, status: 'pending' });
});

// admin approve/reject
app.post('/api/admin/spots/:id/approve', writeLimiter, (req, res) => {
  if ((process.env.ADMIN_TOKEN || '') !== (req.headers['x-admin-token'] || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const info = db.prepare(`UPDATE spots SET status='approved' WHERE id=?`).run(req.params.id);
  res.json({ ok: true, updated: info.changes });
});

app.post('/api/admin/spots/:id/reject', writeLimiter, (req, res) => {
  if ((process.env.ADMIN_TOKEN || '') !== (req.headers['x-admin-token'] || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const info = db.prepare(`UPDATE spots SET status='rejected' WHERE id=?`).run(req.params.id);
  res.json({ ok: true, updated: info.changes });
});

app.listen(PORT, () => {
  console.log('Study Spots API listening on :' + PORT);
});