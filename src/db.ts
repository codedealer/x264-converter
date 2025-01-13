import { dirname } from 'path';
import { existsSync } from "node:fs";
import { mkdirSync } from "fs";
import Database from "better-sqlite3";
import logger from "./logger";

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
          id
          INTEGER
          PRIMARY
          KEY
          AUTOINCREMENT,
          ino
          TEXT
          UNIQUE
          NOT
          NULL,    -- Inode-based unique identifier
          path
          TEXT,    -- Path for reference
          processed
          BOOLEAN
          DEFAULT
          0,       -- Conversion status
          mtime
          INTEGER, -- Last modification time (optional)
          size
          INTEGER  -- File size in bytes (optional)
      );
  `;
  db.exec(createTableQuery);

  logger.debug(`Database initialized at ${path}`);

  return db;
}

export { initializeDatabase };
