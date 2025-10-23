import Database from 'better-sqlite3';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || './data.db';
const SRC = process.env.SEED_FILE || '../data/spots.json';

const db = new Database(DB_PATH);
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
`);

const raw = fs.readFileSync(SRC, 'utf8');
const spots = JSON.parse(raw);

const upsert = db.prepare(`
INSERT INTO spots (id, name, lat, lng, notes, tags, hours, likes, status)
VALUES (@id, @name, @lat, @lng, @notes, json(@tags), json(@hours), 0, 'approved')
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  lat=excluded.lat,
  lng=excluded.lng,
  notes=excluded.notes,
  tags=excluded.tags,
  hours=excluded.hours
`);

const tx = db.transaction((rows) => {
  for (const s of rows) {
    upsert.run({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      notes: s.notes || null,
      tags: JSON.stringify(s.tags || []),
      hours: JSON.stringify(s.hours || null)
    });
  }
});

tx(spots);
console.log(`Seeded ${spots.length} spots from ${SRC}.`);
