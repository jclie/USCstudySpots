// Import required modules
import Database from 'better-sqlite3';  // Fast, synchronous SQLite library
import fs from 'fs';                    // Node's file system module

// --- Configuration constants ---
const DB_PATH = process.env.DB_PATH || './data.db';        // Path to SQLite database file
const SRC = process.env.SEED_FILE || '../data/spots.json'; // Path to JSON seed data file

// --- Initialize database ---
const db = new Database(DB_PATH); // Open or create the database file

// Create the "spots" table if it doesn't already exist
db.exec(`
CREATE TABLE IF NOT EXISTS spots (
  id TEXT PRIMARY KEY,                          -- Unique identifier (string ID)
  name TEXT NOT NULL,                           -- Name of the study spot
  lat REAL NOT NULL,                            -- Latitude coordinate
  lng REAL NOT NULL,                            -- Longitude coordinate
  notes TEXT,                                   -- Optional notes about the spot
  tags TEXT,                                    -- JSON array of category tags
  hours TEXT,                                   -- JSON object of open hours
  likes INTEGER NOT NULL DEFAULT 0,             -- Like count (starts at 0)
  status TEXT NOT NULL DEFAULT 'approved',      -- Spot status (default = approved)
  created_at TEXT NOT NULL DEFAULT (datetime('now')) -- Timestamp when created
);
`);

// --- Read and parse seed data file ---
const raw = fs.readFileSync(SRC, 'utf8'); // Load JSON file contents as a string
const spots = JSON.parse(raw);             // Parse string into an array of objects

// --- Define prepared statement for upsert (insert or update) ---
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
// Explanation:
// - Inserts each spot row if it doesn't exist.
// - If a spot with the same ID already exists, updates its name, coords, notes, tags, and hours.
// - Keeps existing likes and created_at values intact.

// --- Define transaction for batch inserting/updating ---
const tx = db.transaction((rows) => {
  for (const s of rows) {
    upsert.run({
      id: s.id,                           // Unique spot ID
      name: s.name,                       // Spot name
      lat: s.lat,                         // Latitude
      lng: s.lng,                         // Longitude
      notes: s.notes || null,             // Optional notes
      tags: JSON.stringify(s.tags || []), // Serialize tags array to JSON
      hours: JSON.stringify(s.hours || null) // Serialize hours object to JSON
    });
  }
});
// Using a transaction ensures that all inserts/updates either succeed together or fail together,
// which makes the seeding process much faster and safer.

// --- Execute the transaction with parsed data ---
tx(spots);

// --- Log result to console ---
console.log(`Seeded ${spots.length} spots from ${SRC}.`);