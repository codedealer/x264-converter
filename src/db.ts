import { dirname, join } from 'path';
import { existsSync, unlinkSync } from "node:fs";
import { mkdirSync, } from "fs";
import Database from "better-sqlite3";
import logger from "./logger";

const getDbPath = () => {
  const dbDir = 'pkg' in process ? dirname(process.execPath) : process.cwd();
  return join(dbDir, 'x264-db.sqlite');
}

const deleteDatabase = (path: string) => {
  if (existsSync(path)) {
    logger.debug(`Deleting database at ${path}`);
    unlinkSync(path);
    return;
  } else {
    logger.warn(`Database not found at ${path}`);
  }
}

const initializeDatabase = (path: string) => {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(path);

  // Enable WAL (Write-Ahead Logging) for better performance
  db.pragma('journal_mode = WAL');

  // Create the table if it doesn't exist
  const createTableQuery = `
      CREATE TABLE IF NOT EXISTS files
      (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ino TEXT UNIQUE NOT NULL,    -- Inode-based unique identifier
          path TEXT,                   -- Path for reference
          processed BOOLEAN DEFAULT 0, -- Conversion status
          mtime REAL,                  -- Last modification time (optional)
          size INTEGER,                -- File size in bytes (optional)
          media_info TEXT              -- JSON string with codec and resolution info
      );
  `;
  db.exec(createTableQuery);

  logger.debug(`Database initialized at ${path}`);

  return db;
}

interface File {
  id: number;
  ino: string;
  path: string;
  processed: boolean;
  mtime: number | null;
  size: number | null;
  media_info: string | null;
}

const getFileByIno = (db: Database.Database, ino: number) => {
  const stmt = db.prepare('SELECT * FROM files WHERE ino = ?');
  const res = stmt.get(ino) as File | undefined;
  if (!res) return;

  // TODO: prepare media_info field

  return res;
}

export { getDbPath, initializeDatabase, deleteDatabase, getFileByIno };
