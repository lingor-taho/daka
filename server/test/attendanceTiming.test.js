import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daka-pauses-test-"));
process.env.DATABASE_PATH = path.join(directory, "test.db");
process.env.UPLOAD_DIR = path.join(directory, "uploads");
process.env.INITIAL_ADMIN_PASSWORD = "test-password";
const { db } = await import("../src/db.js");
const { calculateAttendanceTime, changeAttendanceState, enrichAttendanceRows } = await import("../src/attendanceTiming.js");
const { buildAttendanceMonth, correctAttendance } = await import("../src/attendance.js");
const { buildDaySchedule } = await import("../src/schedule.js");
const { appDate, setTimeZoneConfig } = await import("../src/utils.js");
const date = "2026-08-20";
const at = hour => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;

test.after(() => {
  db.close();
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});

function seed(day = date, clockIn = at(0)) {
  const id = Number(db.prepare("INSERT INTO employees (name, created_at, updated_at) VALUES ('暂停测试', ?, ?)").run(at(0), at(0)).lastInsertRowid);
  const attendanceId = Number(db.prepare("INSERT INTO attendance (employee_id, attendance_date, clock_in_at, updated_at) VALUES (?, ?, ?, ?)").run(id, day, clockIn, clockIn).lastInsertRowid);
  return { id, attendanceId, day };
}
function read(employee) {
  return enrichAttendanceRows([db.prepare("SELECT * FROM attendance WHERE id = ?").get(employee.attendanceId)])[0];
}
function action(employee, action, hour, revision = read(employee).pause_revision) {
  return changeAttendanceState({ employeeId: employee.id, date: employee.day, action, revision, now: new Date(at(hour)) });
}

test("multiple pauses deduct from checkout and persist across schedule/calendar reads", () => {
  const employee = seed();
  action(employee, "pause", 1);
  assert.equal(buildDaySchedule(date, { currentEmployeeId: employee.id }).employees.find(e => e.id === employee.id).attendance.status, "paused");
  action(employee, "resume", 2);
  action(employee, "pause", 4);
  action(employee, "resume", 6);
  const result = action(employee, "checkout", 9);
  assert.equal(result.attendance.work_seconds, 6 * 3600);
  assert.equal(result.attendance.pause_seconds, 3 * 3600);
  assert.equal(result.summary.status, "checked_out");
  assert.equal(result.attendance.pauses.length, 2);
  const calendar = buildAttendanceMonth(employee.id, "2026-08", "2026-08-31");
  assert.equal(calendar.days[19].record.work_seconds, 6 * 3600);
  assert.equal(calendar.days[19].status, "complete");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_id = ? AND entity_type = 'attendance'").get(String(employee.attendanceId)).n, 5);
});

test("open last pause freezes net time even without checkout; next day never extends it", () => {
  const employee = seed();
  action(employee, "pause", 2);
  action(employee, "resume", 3);
  action(employee, "pause", 6);
  assert.equal(read(employee).work_seconds, 5 * 3600);
  assert.equal(read(employee).work_ended_at, at(6));
  assert.equal(read(employee).clock_out_at, null);
  assert.equal(buildAttendanceMonth(employee.id, "2026-08", date).days[19].status, "paused");
  const next = buildAttendanceMonth(employee.id, "2026-08", "2026-08-21").days[19];
  assert.equal(next.status, "incomplete");
  assert.equal(next.record.work_seconds, 5 * 3600);
  const before = read(employee);
  assert.throws(() => changeAttendanceState({ employeeId: employee.id, date, action: "resume", now: new Date("2026-08-21T00:00:00Z") }), /日期已变化/);
  assert.deepEqual(read(employee), before);
  const result = action(employee, "checkout", 9);
  assert.equal(result.attendance.work_seconds, 5 * 3600);
  assert.equal(result.attendance.pause_seconds, 4 * 3600);
  assert.equal(result.attendance.clock_out_at, at(9));
  assert.equal(result.attendance.pauses.at(-1).resumed_at, null);
});

test("duplicate clicks and stale devices cannot double-pause or accidentally resume", () => {
  const employee = seed();
  const original = read(employee).pause_revision;
  action(employee, "pause", 1, original);
  action(employee, "pause", 2, original);
  assert.equal(read(employee).pauses.length, 1);
  assert.equal(read(employee).paused_at, at(1));
  assert.throws(() => action(employee, "resume", 2, original), error => error.code === "ATTENDANCE_STATE_CHANGED" && error.summary.status === "paused");
  const pausedRevision = read(employee).pause_revision;
  action(employee, "resume", 3);
  action(employee, "resume", 4, pausedRevision);
  assert.equal(read(employee).pauses[0].resumed_at, at(3));
  assert.throws(() => action(employee, "pause", 5, original), /其他页面或设备/);
  action(employee, "checkout", 9);
  assert.equal(action(employee, "checkout", 10).alreadyCheckedOut, true);
  action(employee, "pause", 10);
  action(employee, "resume", 10);
  assert.equal(read(employee).clock_out_at, at(9));
  assert.equal(read(employee).pauses.length, 1);
});

test("missing checkout after resume retains time through the last pause, never counts overnight", () => {
  const employee = seed();
  assert.equal(read(employee).work_seconds, null);
  action(employee, "pause", 1);
  action(employee, "resume", 2);
  assert.equal(read(employee).work_seconds, 3600);
  assert.equal(read(employee).work_ended_at, at(1));
  action(employee, "pause", 5);
  action(employee, "resume", 6);
  assert.equal(read(employee).work_seconds, 4 * 3600);
  assert.equal(read(employee).work_ended_at, at(5));
  assert.equal(buildAttendanceMonth(employee.id, "2026-08", "2026-08-21").days[19].status, "incomplete");
});

test("corrections preserve pauses and clip deductions to corrected bounds", () => {
  const employee = seed();
  action(employee, "pause", 1);
  action(employee, "resume", 3);
  action(employee, "pause", 6);
  action(employee, "checkout", 9);
  const pauses = read(employee).pauses;
  correctAttendance({ id: employee.attendanceId, value: { clockInAt: at(2), clockOutAt: at(7), reason: "校正上下班" } });
  assert.equal(read(employee).work_seconds, 3 * 3600);
  assert.deepEqual(read(employee).pauses, pauses);
  setTimeZoneConfig("Asia/Tokyo", "Asia/Tokyo");
  assert.equal(read(employee).work_seconds, 3 * 3600);
  setTimeZoneConfig("Asia/Shanghai", "Asia/Tokyo");
  db.prepare("DELETE FROM attendance WHERE id = ?").run(employee.attendanceId);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM attendance_pauses WHERE attendance_id = ?").get(employee.attendanceId).n, 0);
});

test("legacy records, overlapping breaks, zero duration and clock rollback are safe", () => {
  const row = { clock_in_at: at(0), clock_out_at: at(9) };
  assert.equal(calculateAttendanceTime(row, []).work_seconds, 9 * 3600);
  assert.equal(calculateAttendanceTime(row, [
    { paused_at: at(1), resumed_at: at(4) }, { paused_at: at(2), resumed_at: at(6) }
  ]).work_seconds, 4 * 3600);
  const employee = seed();
  action(employee, "pause", 0);
  assert.equal(read(employee).work_seconds, 0);
  action(employee, "resume", 2);
  assert.throws(() => action(employee, "pause", 1), /早于已有考勤/);
  assert.equal(read(employee).pauses.length, 1);
  assert.throws(() => changeAttendanceState({ employeeId: 999999, date, action: "pause", now: new Date(at(0)) }), /尚无上班记录/);
});

test("HTTP authorization, multi-device persistence, net calendar/export, and restart", async () => {
  const today = appDate();
  const employee = seed(today, new Date(Date.now() - 60_000).toISOString());
  const other = seed(today, new Date().toISOString());
  const devices = ["pause-test-desktop", "pause-test-phone"];
  for (const code of devices) db.prepare("INSERT INTO devices (device_code, employee_id, enabled, first_seen_at, last_seen_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)").run(code, employee.id, at(0), at(0), at(0));
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let logs = "";
  async function start() {
    child = spawn(process.execPath, ["server/src/index.js"], { cwd: process.cwd(), windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NODE_ENV: "test", SERVE_CLIENT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", chunk => { logs += chunk; });
    child.stderr.on("data", chunk => { logs += chunk; });
    for (let attempt = 0; attempt < 400; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* starting */ }
      if (child.exitCode !== null) throw new Error(logs);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`API start timeout: ${logs}`);
  }
  async function stop() {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
  }
  const post = (action, body, code = devices[0]) => fetch(`${base}/api/front/${action}`, {
    method: "POST", headers: { "content-type": "application/json", "x-device-code": code }, body: JSON.stringify(body)
  });
  try {
    await start();
    assert.equal((await post("pause", { date: today }, "unapproved-device")).status, 403);
    const first = await (await fetch(`${base}/api/front/today`, { headers: { "x-device-code": devices[0] } })).json();
    const initial = first.schedule.employees.find(e => e.isCurrent).attendance;
    assert.equal((await post("pause", { date: "2000-01-01", revision: initial.pauseRevision })).status, 409);
    const pausedResponse = await post("pause", { date: today, revision: initial.pauseRevision, employeeId: other.id });
    assert.equal(pausedResponse.status, 200);
    const paused = await pausedResponse.json();
    assert.equal(paused.attendance.employee_id, employee.id);
    assert.equal(paused.summary.status, "paused");
    assert.equal(read(other).pauses.length, 0);
    await stop();
    await start();
    const phone = await (await fetch(`${base}/api/front/today`, { headers: { "x-device-code": devices[1] } })).json();
    assert.equal(phone.schedule.employees.find(e => e.isCurrent).attendance.status, "paused");
    assert.equal(read(employee).clock_in_at, first.schedule.employees.find(e => e.isCurrent).attendance.clockInAt);
    const stale = await post("resume", { date: today, revision: initial.pauseRevision }, devices[1]);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).summary.status, "paused");
    const checkout = await post("checkout", { date: today, note: "完成" }, devices[1]);
    assert.equal(checkout.status, 200);
    const ended = (await checkout.json()).attendance;
    assert.equal(ended.work_seconds, paused.attendance.work_seconds);
    const login = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "test-password" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const calendar = await (await fetch(`${base}/api/admin/attendance/calendar?employeeId=${employee.id}&month=${today.slice(0, 7)}`, { headers: { cookie } })).json();
    assert.equal(calendar.days.find(day => day.date === today).record.work_seconds, ended.work_seconds);
    const exported = await fetch(`${base}/api/admin/attendance/export.xlsx?employeeId=${employee.id}&start=${today}&end=${today}`, { headers: { cookie } });
    assert.equal(exported.status, 200);
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
    assert.equal(workbook.worksheets[0].getCell("F2").value, Number((ended.work_seconds / 3600).toFixed(2)));
    assert.match(workbook.worksheets[0].getCell("I2").value, /未恢复/);
  } finally { await stop(); }
});
