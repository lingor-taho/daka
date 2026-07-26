import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { config } from "./config.js";
import { appDateTime, setTimeZoneConfig } from "./utils.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

export const db = new Database(config.databasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT NOT NULL UNIQUE,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    label TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    authorized_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS default_task_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_key TEXT NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description_html TEXT NOT NULL DEFAULT '',
    start_hour INTEGER NOT NULL,
    end_hour INTEGER NOT NULL,
    weekdays TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_key, effective_from)
  );

  CREATE INDEX IF NOT EXISTS idx_default_task_versions_lookup
    ON default_task_versions(employee_id, effective_from, task_key);

  CREATE TABLE IF NOT EXISTS daily_task_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_key TEXT NOT NULL,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    task_date TEXT NOT NULL,
    title TEXT NOT NULL,
    description_html TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_key, task_date)
  );

  CREATE TABLE IF NOT EXISTS additional_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    task_date TEXT NOT NULL,
    title TEXT NOT NULL,
    description_html TEXT NOT NULL DEFAULT '',
    start_hour INTEGER NOT NULL,
    end_hour INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_additional_tasks_date_employee
    ON additional_tasks(task_date, employee_id);

  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    holiday_date TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '全员休息日',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    attendance_date TEXT NOT NULL,
    clock_in_at TEXT,
    clock_out_at TEXT,
    checkout_note TEXT NOT NULL DEFAULT '',
    source_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(employee_id, attendance_date)
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date_employee
    ON attendance(attendance_date, employee_id);

  CREATE TABLE IF NOT EXISTS attendance_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendance_id INTEGER NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
    before_json TEXT NOT NULL,
    after_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

const now = appDateTime();
const adminCount = db.prepare("SELECT COUNT(*) AS count FROM admins").get().count;
if (adminCount === 0) {
  db.prepare(
    `INSERT INTO admins (username, password_hash, must_change_password, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`
  ).run(
    config.initialAdminUsername,
    bcrypt.hashSync(config.initialAdminPassword, 12),
    now,
    now
  );
}

const insertSetting = db.prepare(
  `INSERT INTO settings (setting_key, setting_value, updated_at)
   VALUES (?, ?, ?)
   ON CONFLICT(setting_key) DO NOTHING`
);
insertSetting.run("fallback_start_hour", "9", now);
insertSetting.run("fallback_end_hour", "18", now);
insertSetting.run("server_timezone", "Asia/Shanghai", now);
insertSetting.run("display_timezone", "Asia/Tokyo", now);

setTimeZoneConfig(
  db.prepare("SELECT setting_value FROM settings WHERE setting_key = 'server_timezone'").get()
    ?.setting_value ?? "Asia/Shanghai",
  db.prepare("SELECT setting_value FROM settings WHERE setting_key = 'display_timezone'").get()
    ?.setting_value ?? "Asia/Tokyo"
);

export function audit(action, entityType, entityId = null, detail = "") {
  db.prepare(
    `INSERT INTO audit_logs (action, entity_type, entity_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(action, entityType, entityId == null ? null : String(entityId), detail, appDateTime());
}

export function setting(key, fallback = "") {
  return db.prepare("SELECT setting_value FROM settings WHERE setting_key = ?").get(key)?.setting_value ?? fallback;
}
