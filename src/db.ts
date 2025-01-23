import { dirname, join } from 'path';
import { existsSync, unlinkSync } from "node:fs";
import { mkdirSync, } from "fs";
import Database from "better-sqlite3";
import logger from "./logger";
import { MediaInfo } from "./fileInfo";

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
          ino INTEGER UNIQUE NOT NULL,    -- Inode-based unique identifier
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

interface VideoFileRaw {
  id: number;
  ino: number;
  path: string;
  processed: number;
  mtime: number | null;
  size: number | null;
  media_info: string | null;
}

export interface VideoFile extends Omit<VideoFileRaw, 'media_info' | 'id' | 'processed'> {
  processed: boolean;
  media_info: MediaInfo | null;
}

const getVideoFileByIno = (db: Database.Database, ino: number) => {
  const stmt = db.prepare('SELECT * FROM files WHERE ino = ?');
  const res = stmt.get(ino) as VideoFileRaw | undefined;
  if (!res) return;

  const { media_info, id, processed, ...rest } = res;
  const file = { ...rest, media_info: null, processed: processed > 0 } as VideoFile;
  if (media_info) {
    file.media_info = JSON.parse(media_info) as unknown as MediaInfo;
  }
  return file;
}

const prepareValues = (file: Partial<VideoFile>) => {
  const values = Object.keys(file).map(field => {
    let value = (file as any)[field];
    value = typeof value === 'boolean' ? value ? 1 : 0 : value;
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
  });
  return values;
}

const insertVideoFile = (db: Database.Database, file: Partial<VideoFile>) => {
  if ('id' in file) {
    delete file.id;
  }
  const requiredFields = ['ino', 'path'];
  for (const field of requiredFields) {
    if (!(field in file)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const fields = Object.keys(file);
  const placeholders = fields.map(() => '?').join(', ');
  const query = `INSERT INTO files (${fields.join(', ')}) VALUES (${placeholders})`;

  const stmt = db.prepare(query);
  stmt.run(...prepareValues(file));
}

const updateVideoFile = (db: Database.Database, file: Partial<VideoFile>) => {
  if ('id' in file) {
    delete file.id;
  }
  if (!('ino' in file)) {
    throw new Error('Missing required field: ino');
  }
  if (!file.path) {
    throw new Error('Path cannot be empty');
  }

  const fields = Object.keys(file).filter(field => field !== 'ino');
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const query = `UPDATE files SET ${setClause} WHERE ino = ?`;

  // ino cannot be updated
  const { ino, ...rest } = file;

  const stmt = db.prepare(query);
  stmt.run(...prepareValues(rest), file.ino);
}

export {
  getDbPath,
  initializeDatabase,
  deleteDatabase,
  getVideoFileByIno,
  insertVideoFile,
  updateVideoFile,
};
