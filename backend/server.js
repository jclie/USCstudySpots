// Import core dependencies
import express from 'express';            // Web framework for building HTTP APIs
import helmet from 'helmet';              // Sets secure HTTP headers
import cors from 'cors';                  // Enables Cross-Origin Resource Sharing
import Database from 'better-sqlite3';    // Synchronous, fast SQLite driver
import { nanoid } from 'nanoid';          // Generates short, unique IDs
import rateLimit from 'express-rate-limit'; // Simple request rate limiting
import { z } from 'zod';                  // Runtime schema validation

// App configuration
const PORT = process.env.PORT || 3000;            // Port to listen on
const DB_PATH = process.env.DB_PATH || './data.db'; // SQLite DB file path

// Open DB connection and set pragmas (performance / integrity)
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // Better concurrency & crash safety
db.pragma('foreign_keys = ON');  // Enforce foreign key constraints

// Create and configure the Express appß
const app = express();
app.use(helmet());                     // Add various security headers
app.use(cors({ origin: true }));       // Allow CORS (reflects Origin)
app.use(express.json());               // Parse JSON request bodies

// Rate limiters to protect write-heavy endpoints
const writeLimiter = rateLimit({ windowMs: 60_000, max: 20 }); // 20 writes/minute
const likeLimiter  = rateLimit({ windowMs: 60_000, max: 60 }); // 60 likes/minute

// Create tables if they don't exist
db.exec(`
CREATE TABLE IF NOT EXISTS spots (
  id TEXT PRIMARY KEY,                         -- Spot ID (nanoid)
  name TEXT NOT NULL,                          -- Display name
  lat REAL NOT NULL,                           -- Latitude
  lng REAL NOT NULL,                           -- Longitude
  notes TEXT,                                  -- Freeform notes
  tags TEXT,                                   -- JSON-encoded array of strings
  hours TEXT,                                  -- JSON-encoded opening hours
  likes INTEGER NOT NULL DEFAULT 0,            -- Aggregated like count
  status TEXT NOT NULL DEFAULT 'approved',     -- 'pending' | 'approved' | 'rejected'
  created_at TEXT NOT NULL DEFAULT (datetime('now')) -- Creation timestamp
);
CREATE TABLE IF NOT EXISTS likes (
  spot_id TEXT NOT NULL,                       -- FK to spots.id
  fingerprint TEXT NOT NULL,                   -- IP+UA token for idempotent like
  liked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (spot_id, fingerprint),          -- Prevent duplicate likes per fingerprint
  FOREIGN KEY (spot_id) REFERENCES spots(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,                         -- Submission ID (nanoid)
  payload TEXT NOT NULL,                       -- JSON-encoded submission data
  status TEXT NOT NULL DEFAULT 'pending',      -- Review status
  submitted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Helper: map DB row to clean Spot object (parse JSON fields)
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

// Helper: generate a coarse fingerprint to dedupe likes per client
function getFingerprint(req){
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const ua = (req.headers['user-agent'] || '').toString();
  return ip + '|' + ua.slice(0, 64); // Truncate UA to keep it short
}

// Zod schema: validates incoming "submit spot" payloads
const SpotSubmission = z.object({
  name: z.string().min(2).max(80),              // 2–80 chars
  lat: z.number().gte(-90).lte(90),             // Valid latitude
  lng: z.number().gte(-180).lte(180),           // Valid longitude
  notes: z.string().max(500).optional().nullable(), // Optional notes
  tags: z.array(z.string()).max(12).optional().default([]), // Up to 12 tags
  hours: z.record(                               // Optional hours: { day: [{open, close}] }
    z.string(),
    z.array(z.object({
      open: z.string().regex(/^\d{2}:\d{2}$/),   // "HH:MM"
      close: z.string().regex(/^\d{2}:\d{2}$/)
    }))
  ).optional()
});

// --- Routes ---

// Health check: quick liveness probe
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// List all approved spots
app.get('/api/spots', (req, res) => {
  const rows = db.prepare(`SELECT * FROM spots WHERE status='approved'`).all();
  res.json(rows.map(rowToSpot));
});

// Get a single spot (any status)
app.get('/api/spots/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM spots WHERE id=?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(rowToSpot(row));
});

// Like a spot (idempotent per fingerprint)
app.post('/api/spots/:id/like', likeLimiter, (req, res) => {
  const id = req.params.id;
  // Only approved spots can be liked
  const spot = db.prepare(`SELECT * FROM spots WHERE id=? AND status='approved'`).get(id);
  if (!spot) return res.status(404).json({ error: 'Spot not found' });

  const fp = getFingerprint(req);
  const exists = db.prepare(`SELECT 1 FROM likes WHERE spot_id=? AND fingerprint=?`).get(id, fp);

  // If already liked by this fingerprint, return current like count unchanged
  if (exists) {
    return res.json({ ok: true, liked: true, likes: spot.likes });
  }

  // Transactionally insert like and increment counter
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO likes (spot_id, fingerprint) VALUES (?, ?)`).run(id, fp);
    db.prepare(`UPDATE spots SET likes=likes+1 WHERE id=?`).run(id);
    return db.prepare(`SELECT likes FROM spots WHERE id=?`).get(id).likes;
  });

  const total = tx();
  res.json({ ok: true, liked: true, likes: total });
});

// Submit a new spot (creates a 'pending' submission and spot)
app.post('/api/spots', writeLimiter, (req, res) => {
  // Validate request body against schema
  const parsed = SpotSubmission.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', issues: parsed.error.issues });
    // Returns Zod validation issues for client-side debugging
  }

  // Create a submission record for moderation
  const subId = nanoid(12);
  const payload = parsed.data;
  db.prepare(`INSERT INTO submissions (id, payload, status) VALUES (?, ?, 'pending')`)
    .run(subId, JSON.stringify(payload));

  // Also create a corresponding spot in 'pending' status
  const spotId = nanoid(10);
  db.prepare(`INSERT INTO spots (id, name, lat, lng, notes, tags, hours, status) 
              VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .run(
      spotId,
      payload.name,
      payload.lat,
      payload.lng,
      payload.notes || null,
      JSON.stringify(payload.tags || []),
      payload.hours ? JSON.stringify(payload.hours) : null
    );

  // Return Accepted with IDs for tracking
  res.status(202).json({ ok: true, id: spotId, submission_id: subId, status: 'pending' });
});

// Admin: approve a pending spot (requires x-admin-token header)
app.post('/api/admin/spots/:id/approve', writeLimiter, (req, res) => {
  if ((process.env.ADMIN_TOKEN || '') !== (req.headers['x-admin-token'] || '')) {
    return res.status(401).json({ error: 'Unauthorized' }); // Guarded by static token
  }
  const info = db.prepare(`UPDATE spots SET status='approved' WHERE id=?`).run(req.params.id);
  res.json({ ok: true, updated: info.changes }); // 'changes' is number of rows updated
});

// Admin: reject a spot (requires x-admin-token header)
app.post('/api/admin/spots/:id/reject', writeLimiter, (req, res) => {
  if ((process.env.ADMIN_TOKEN || '') !== (req.headers['x-admin-token'] || '')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const info = db.prepare(`UPDATE spots SET status='rejected' WHERE id=?`).run(req.params.id);
  res.json({ ok: true, updated: info.changes });
});

// Start the HTTP server
app.listen(PORT, () => {
  console.log('Study Spots API listening on :' + PORT);
});