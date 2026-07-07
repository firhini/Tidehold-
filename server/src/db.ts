/**
 * Persistence layer. The game lives in memory (see state.ts); SQLite is the
 * durability layer — state is flushed after every tick and on shutdown.
 * JSON-document tables keep the schema honest without ORM ceremony.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

export function openDb(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tiles (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passhash TEXT NOT NULL,
      state TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS armies (id TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS battles (id TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expeditions (id TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS battle_reports (
      id TEXT PRIMARY KEY,
      tick INTEGER NOT NULL,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_id TEXT,
      target_id TEXT,
      q INTEGER,
      r INTEGER,
      is_public INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);
    CREATE TABLE IF NOT EXISTS chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tick INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      username TEXT NOT NULL,
      message TEXT NOT NULL
    );
  `);
  return db;
}
