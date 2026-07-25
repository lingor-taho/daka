import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "kumohiro-daka-test-"));
process.env.DATABASE_PATH = path.join(testDirectory, "test.db");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.INITIAL_ADMIN_PASSWORD = "test-password";

const { db } = await import("../src/db.js");
const { buildDaySchedule } = await import("../src/schedule.js");
const {
  chinaDate,
  parseDate,
  validateTimeRange,
  validateWeekdays
} = await import("../src/utils.js");

test.after(() => {
  db.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test("validates dates, hours and weekdays", () => {
  assert.equal(parseDate("2026-07-25"), "2026-07-25");
  assert.deepEqual(validateTimeRange(9, 18), { startHour: 9, endHour: 18 });
  assert.deepEqual(validateWeekdays([5, 1, 1, 3]), [1, 3, 5]);
  assert.throws(() => validateTimeRange(10, 10), /结束时间/);
  assert.throws(() => validateWeekdays([]), /至少选择/);
  assert.match(chinaDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test("builds default, overridden and overlapping additional tasks", () => {
  const now = "2026-07-25T09:00:00+08:00";
  const employeeId = db.prepare(
    `INSERT INTO employees (name, position, active, display_order, created_at, updated_at)
     VALUES ('张三', '打包', 1, 1, ?, ?)`
  ).run(now, now).lastInsertRowid;

  db.prepare(
    `INSERT INTO default_task_versions (
       task_key, employee_id, title, description_html, start_hour, end_hour,
       weekdays, effective_from, is_active, created_at, updated_at
     ) VALUES ('task-a', ?, '打包', '<p>默认说明</p>', 9, 13, '[6]', '2026-07-01', 1, ?, ?)`
  ).run(employeeId, now, now);

  db.prepare(
    `INSERT INTO daily_task_overrides (
       task_key, employee_id, task_date, title, description_html, created_at, updated_at
     ) VALUES ('task-a', ?, '2026-07-25', '拍照', '<p>当天替换</p>', ?, ?)`
  ).run(employeeId, now, now);

  db.prepare(
    `INSERT INTO additional_tasks (
       employee_id, task_date, title, description_html, start_hour, end_hour, created_at, updated_at
     ) VALUES (?, '2026-07-25', '临时盘点', '', 10, 12, ?, ?)`
  ).run(employeeId, now, now);

  const schedule = buildDaySchedule("2026-07-25", { currentEmployeeId: Number(employeeId) });
  assert.deepEqual(schedule.range, { startHour: 9, endHour: 13 });
  assert.equal(schedule.employees.length, 1);
  assert.equal(schedule.employees[0].tasks.length, 2);
  assert.equal(schedule.employees[0].tasks[0].title, "拍照");
  assert.equal(schedule.employees[0].tasks[0].source, "override");
  assert.equal(schedule.employees[0].tasks[1].source, "additional");
  assert.equal(schedule.employees[0].isCurrent, true);
});

test("holiday hides defaults but retains additional tasks", () => {
  const now = "2026-07-25T09:00:00+08:00";
  db.prepare(
    `INSERT INTO holidays (holiday_date, name, created_at, updated_at)
     VALUES ('2026-07-25', '测试休息日', ?, ?)`
  ).run(now, now);
  const schedule = buildDaySchedule("2026-07-25");
  assert.equal(schedule.holiday.name, "测试休息日");
  assert.equal(schedule.employees[0].tasks.length, 1);
  assert.equal(schedule.employees[0].tasks[0].source, "additional");
});

test("attendance uniqueness preserves the first clock-in", () => {
  const employeeId = db.prepare("SELECT id FROM employees LIMIT 1").get().id;
  const first = "2026-07-25T08:58:00+08:00";
  const second = "2026-07-25T09:05:00+08:00";
  db.prepare(
    `INSERT INTO attendance (employee_id, attendance_date, clock_in_at, updated_at)
     VALUES (?, '2026-07-25', ?, ?)
     ON CONFLICT(employee_id, attendance_date) DO NOTHING`
  ).run(employeeId, first, first);
  db.prepare(
    `INSERT INTO attendance (employee_id, attendance_date, clock_in_at, updated_at)
     VALUES (?, '2026-07-25', ?, ?)
     ON CONFLICT(employee_id, attendance_date) DO NOTHING`
  ).run(employeeId, second, second);
  const row = db
    .prepare("SELECT clock_in_at FROM attendance WHERE employee_id = ? AND attendance_date = '2026-07-25'")
    .get(employeeId);
  assert.equal(row.clock_in_at, first);
});

