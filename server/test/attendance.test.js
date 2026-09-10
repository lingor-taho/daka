import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "daka-attendance-test-"));
process.env.DATABASE_PATH = path.join(testDirectory, "test.db");
process.env.UPLOAD_DIR = path.join(testDirectory, "uploads");
process.env.INITIAL_ADMIN_PASSWORD = "test-password";
const { db } = await import("../src/db.js");
const { buildAttendanceMonth, correctAttendance, monthDates } = await import("../src/attendance.js");
const { setTimeZoneConfig } = await import("../src/utils.js");
const now = "2026-07-01T00:00:00Z";

test.after(() => {
  db.close();
  // This exact directory was created above exclusively for these test records.
  assert.equal(path.dirname(testDirectory), path.resolve(os.tmpdir()));
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

function employee(name = "测试员工", order = 1) {
  return Number(db.prepare("INSERT INTO employees (name, position, display_order, created_at, updated_at) VALUES (?, '测试', ?, ?, ?)").run(name, order, now, now).lastInsertRowid);
}
function attendance(employeeId, date, clockIn = `${date}T00:00:00Z`, clockOut = `${date}T09:00:00Z`) {
  return Number(db.prepare("INSERT INTO attendance (employee_id, attendance_date, clock_in_at, clock_out_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(employeeId, date, clockIn, clockOut, now).lastInsertRowid);
}
function template(employeeId, key, effective, weekdays = [1, 2, 3, 4, 5], active = 1) {
  db.prepare(`INSERT INTO default_task_versions (task_key, employee_id, title, start_hour, end_hour, weekdays, effective_from, is_active, created_at, updated_at)
    VALUES (?, ?, '默认工作', 9, 18, ?, ?, ?, ?, ?)`).run(key, employeeId, JSON.stringify(weekdays), effective, active, now, now);
}

test("month boundaries include leap years, default employee and first attendance month", () => {
  assert.equal(buildAttendanceMonth(0, "2026-09", "2026-09-10").employee, null);
  assert.equal(monthDates("2024-02").length, 29);
  assert.equal(monthDates("2025-02").length, 28);
  assert.throws(() => monthDates("2026-13"), /日期无效/);
  assert.throws(() => monthDates("2026-9"), /月份格式/);
  const id = employee("第一位", -1);
  attendance(id, "2026-08-31");
  assert.equal(buildAttendanceMonth(0, "2026-09", "2026-09-10").employee.id, id);
  const first = buildAttendanceMonth(id, "2020-01", "2026-09-10");
  assert.equal(first.firstMonth, "2026-08");
  assert.equal(first.month, "2026-08");
  assert.equal(buildAttendanceMonth(id, "2027-01", "2026-09-10").month, "2026-09");
  const noRecords = employee("暂无考勤");
  assert.equal(buildAttendanceMonth(noRecords, "2026-09", "2026-09-10").firstMonth, "2026-07");
});

test("calendar distinguishes absence, incomplete, today, holidays, future and unscheduled work", () => {
  const id = employee();
  template(id, "calendar-main", "2026-07-01");
  attendance(id, "2026-08-31");
  attendance(id, "2026-09-01");
  attendance(id, "2026-09-03", "2026-09-03T00:00:00Z", null);
  attendance(id, "2026-09-10", "2026-09-10T00:00:00Z", null);
  attendance(id, "2026-09-06"); // Attendance counts even without a task.
  for (const date of ["2026-09-07", "2026-09-08"]) {
    db.prepare("INSERT INTO holidays (holiday_date, name, created_at, updated_at) VALUES (?, '休息', ?, ?)").run(date, now, now);
  }
  db.prepare("INSERT INTO additional_tasks (employee_id, task_date, title, start_hour, end_hour, created_at, updated_at) VALUES (?, '2026-09-08', '加班', 10, 12, ?, ?)").run(id, now, now);
  const days = buildAttendanceMonth(id, "2026-09", "2026-09-10").days;
  const day = number => days[number - 1];
  assert.equal(day(1).status, "complete");
  assert.equal(day(2).status, "absent");
  assert.equal(day(2).editable, true);
  assert.equal(day(3).status, "incomplete");
  assert.equal(day(5).status, "unscheduled");
  assert.equal(day(6).status, "complete");
  assert.equal(day(7).status, "rest");
  assert.equal(day(8).status, "absent");
  assert.equal(day(10).status, "working");
  assert.equal(day(11).status, "future");
  assert.equal(day(11).editable, false);
  assert.equal(buildAttendanceMonth(id, "2026-09", "2026-09-02").days[1].status, "pending");
});

test("absence follows historical template versions and weekdays, not the newest template", () => {
  const id = employee();
  attendance(id, "2026-08-31");
  template(id, "versions", "2026-07-01");
  template(id, "versions", "2026-09-03", [2]);
  template(id, "versions", "2026-09-09", [2], 0);
  const days = buildAttendanceMonth(id, "2026-09", "2026-09-30").days;
  assert.equal(days[1].status, "absent"); // Wed before version change.
  assert.equal(days[2].status, "unscheduled"); // Thu after Tuesday-only change.
  assert.equal(days[14].status, "unscheduled"); // Tue after template disabled.
});

test("corrections and new entries store UTC and keep audit history atomically", () => {
  setTimeZoneConfig("Asia/Shanghai", "Asia/Tokyo");
  const id = employee();
  const value = { clockInAt: "2026-09-02T00:30", clockOutAt: "2026-09-02T17:00", checkoutNote: "已完成", reason: "漏打卡补录" };
  const row = correctAttendance({ employeeId: id, date: "2026-09-02", value });
  assert.equal(row.clock_in_at, "2026-09-01T15:30:00.000Z");
  assert.equal(row.attendance_date, "2026-09-02");
  assert.equal(buildAttendanceMonth(id, "2026-09", "2026-09-10").days[1].status, "complete");
  assert.throws(() => correctAttendance({ employeeId: id, date: "2026-09-02", value }), /已有考勤/);
  const corrected = correctAttendance({ id: row.id, value: { ...value, clockOutAt: "2026-09-02T18:00" } });
  assert.equal(corrected.clock_out_at, "2026-09-02T09:00:00.000Z");
  const logs = db.prepare("SELECT * FROM attendance_corrections WHERE attendance_id = ? ORDER BY id").all(row.id);
  assert.equal(logs.length, 2);
  assert.equal(JSON.parse(logs[0].before_json), null);
  assert.equal(JSON.parse(logs[1].before_json).clock_out_at, row.clock_out_at);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = 'attendance' AND entity_id = ?").get(String(row.id)).n, 2);
  setTimeZoneConfig("Asia/Tokyo", "Asia/Tokyo");
  assert.equal(buildAttendanceMonth(id, "2026-09", "2026-09-10").days[1].record.clock_in_at, row.clock_in_at);
});

test("invalid corrections leave the record unchanged and do not create audit entries", () => {
  const id = employee();
  const rowId = attendance(id, "2026-09-01");
  const before = db.prepare("SELECT * FROM attendance WHERE id = ?").get(rowId);
  for (const value of [
    { reason: "" },
    { clockInAt: "2026-09-02T09:00", reason: "日期错误" },
    { clockInAt: "2026-09-01T18:00", clockOutAt: "2026-09-01T09:00", reason: "倒序" },
    { clockOutAt: "2026-09-01T18:00", reason: "缺少上班" }
  ]) assert.throws(() => correctAttendance({ id: rowId, value }));
  assert.throws(() => correctAttendance({ employeeId: id, date: "2999-01-01", value: { reason: "未来" } }), /未来/);
  assert.deepEqual(db.prepare("SELECT * FROM attendance WHERE id = ?").get(rowId), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attendance_corrections WHERE attendance_id = ?").get(rowId).n, 0);
});
