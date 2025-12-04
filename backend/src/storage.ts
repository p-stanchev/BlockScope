import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { BlockMeta } from "./types.js";

let db: Database.Database | null = null;

export function initStorage() {
  const shouldPersist = process.env.PERSIST_HISTORY === "true";
  if (!shouldPersist) return null;
  const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), "blockscope.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.prepare(
    `CREATE TABLE IF NOT EXISTS blocks (
      slot INTEGER PRIMARY KEY,
      timestamp INTEGER,
      tx_count INTEGER,
      compute_total INTEGER,
      fee_total REAL,
      load TEXT,
      fullness REAL
    );`
  ).run();
  db.prepare(
    `CREATE TABLE IF NOT EXISTS program_compute (
      slot INTEGER,
      program_id TEXT,
      compute INTEGER,
      PRIMARY KEY (slot, program_id)
    );`
  ).run();
  return dbPath;
}

export function persistBlock(meta: BlockMeta) {
  if (!db) return;
  const insertBlock = db.prepare(
    `INSERT OR REPLACE INTO blocks(slot, timestamp, tx_count, compute_total, fee_total, load, fullness)
     VALUES (@slot, @timestamp, @txCount, @computeTotal, @feeTotal, @load, @fullness)`
  );
  insertBlock.run({
    slot: meta.slot,
    timestamp: Math.round(meta.timestamp),
    txCount: meta.txCount,
    computeTotal: meta.computeTotal,
    feeTotal: meta.feeTotal,
    load: meta.load,
    fullness: meta.fullness
  });
  const insertProg = db.prepare(
    `INSERT OR REPLACE INTO program_compute(slot, program_id, compute)
     VALUES (@slot, @programId, @compute)`
  );
  const tx = db.transaction((entries: [string, number][]) => {
    for (const [programId, compute] of entries) {
      insertProg.run({ slot: meta.slot, programId, compute });
    }
  });
  tx(Object.entries(meta.computePerProgram || {}));
}

export function queryTopPrograms(hours: number, limit = 10) {
  if (!db) return [];
  const since = Math.round(Date.now() / 1000) - hours * 3600;
  return db
    .prepare(
      `SELECT program_id as programId, SUM(compute) as compute
       FROM program_compute pc
       JOIN blocks b ON b.slot = pc.slot
       WHERE b.timestamp >= ?
       GROUP BY program_id
       ORDER BY compute DESC
       LIMIT ?`
    )
    .all(since, limit);
}

export function querySlotFullnessPerHour(hours: number) {
  if (!db) return [];
  const since = Math.round(Date.now() / 1000) - hours * 3600;
  return db
    .prepare(
      `SELECT (b.timestamp/3600)*3600 as hour, AVG(b.fullness) as avgFullness
       FROM blocks b
       WHERE b.timestamp >= ?
       GROUP BY hour
       ORDER BY hour DESC`
    )
    .all(since);
}

export function queryFeeVsCompute(hours: number) {
  if (!db) return [];
  const since = Math.round(Date.now() / 1000) - hours * 3600;
  return db
    .prepare(
      `SELECT b.compute_total as compute, b.fee_total as fee, b.fullness, b.load
       FROM blocks b
       WHERE b.timestamp >= ?
       ORDER BY b.timestamp DESC
       LIMIT 5000`
    )
    .all(since);
}
