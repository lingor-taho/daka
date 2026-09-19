import { audit, db } from "./db.js";
import { enrichAttendanceRows } from "./attendanceTiming.js";
import { appDate, appDateTime, httpError, parseDate, safeText, weekdayForDate, zonedLocalDateTimeToIso } from "./utils.js";

export function monthDates(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw httpError(400, "月份格式无效");
  const start = parseDate(`${month}-01`);
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${start.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`);
}

export function buildAttendanceMonth(employeeId, requestedMonth, today = appDate()) {
  parseDate(today);
  const employee = employeeId
    ? db.prepare("SELECT * FROM employees WHERE id = ?").get(employeeId)
    : db.prepare("SELECT * FROM employees ORDER BY display_order, id LIMIT 1").get();
  const currentMonth = today.slice(0, 7);
  if (!employee) {
    if (employeeId) throw httpError(404, "员工不存在");
    return { employee: null, today, month: currentMonth, firstMonth: currentMonth, currentMonth, days: [] };
  }
  const firstDate = db.prepare("SELECT MIN(attendance_date) AS date FROM attendance WHERE employee_id = ? AND attendance_date <= ?")
    .get(employee.id, today).date;
  const joinedDate = appDate(new Date(employee.created_at));
  const firstMonth = (firstDate || joinedDate).slice(0, 7) < currentMonth
    ? (firstDate || joinedDate).slice(0, 7) : currentMonth;
  const requested = requestedMonth || currentMonth;
  monthDates(requested);
  const month = requested < firstMonth ? firstMonth : requested > currentMonth ? currentMonth : requested;
  const dates = monthDates(month);
  const start = dates[0];
  const end = dates.at(-1);
  const records = new Map(enrichAttendanceRows(db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND attendance_date BETWEEN ? AND ?")
    .all(employee.id, start, end)).map(row => [row.attendance_date, { ...row, name: employee.name, position: employee.position }]));
  const holidays = new Map(db.prepare("SELECT holiday_date, name FROM holidays WHERE holiday_date BETWEEN ? AND ?")
    .all(start, end).map(row => [row.holiday_date, row.name]));
  const additions = new Set(db.prepare("SELECT DISTINCT task_date FROM additional_tasks WHERE employee_id = ? AND task_date BETWEEN ? AND ?")
    .all(employee.id, start, end).map(row => row.task_date));
  // Load the last version at month start plus changes within the month, including
  // inactive versions. This preserves effective dates without one query per day.
  const versions = db.prepare(`SELECT v.task_key, v.effective_from, v.is_active, v.weekdays
    FROM default_task_versions v
    WHERE v.employee_id = ? AND v.effective_from <= ? AND (v.effective_from >= ? OR NOT EXISTS (
      SELECT 1 FROM default_task_versions newer WHERE newer.task_key = v.task_key
      AND newer.effective_from > v.effective_from AND newer.effective_from <= ?
    )) ORDER BY v.effective_from, v.id`).all(employee.id, end, start, start)
    .map(row => ({ ...row, weekdays: JSON.parse(row.weekdays) }));
  const activeVersions = new Map();
  let versionIndex = 0;
  const days = dates.map(date => {
    while (versionIndex < versions.length && versions[versionIndex].effective_from <= date) {
      const version = versions[versionIndex++];
      activeVersions.set(version.task_key, version);
    }
    const record = records.get(date) || null;
    const holiday = holidays.get(date) || null;
    const scheduled = additions.has(date) || (!holiday && [...activeVersions.values()]
      .some(version => version.is_active && version.weekdays.includes(weekdayForDate(date))));
    let status;
    if (date > today) status = "future";
    else if (record?.clock_in_at && record?.clock_out_at) status = "complete";
    else if (record?.clock_in_at) status = date === today ? (record.paused_at ? "paused" : "working") : "incomplete";
    else if (record?.clock_out_at) status = "incomplete";
    else if (date < joinedDate) status = "untracked";
    else if (holiday && !additions.has(date)) status = "rest";
    else if (date === today) status = "pending";
    else if (scheduled) status = "absent";
    else status = "unscheduled";
    return { date, status, scheduled, holiday, record, editable: date <= today && (date >= joinedDate || Boolean(record)) };
  });
  return { employee: { ...employee, active: Boolean(employee.active) }, today, month, firstMonth, currentMonth, days };
}

function normalizeDateTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return zonedLocalDateTimeToIso(text);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw httpError(400, "日期时间格式无效");
  return date.toISOString();
}

export function correctAttendance({ id, employeeId, date, value }) {
  return db.transaction(() => {
    const previous = id ? db.prepare("SELECT * FROM attendance WHERE id = ?").get(id) : null;
    if (id && !previous) throw httpError(404, "考勤记录不存在");
    const attendanceDate = parseDate(previous?.attendance_date || date);
    const targetEmployeeId = previous?.employee_id || employeeId;
    const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(targetEmployeeId);
    if (!employee) throw httpError(404, "员工不存在");
    if (attendanceDate > appDate()) throw httpError(400, "不能修改未来日期的考勤");
    if (!previous && db.prepare("SELECT id FROM attendance WHERE employee_id = ? AND attendance_date = ?").get(targetEmployeeId, attendanceDate)) {
      throw httpError(409, "该日已有考勤记录，请刷新后修改");
    }
    if (!previous && attendanceDate < appDate(new Date(employee.created_at))) throw httpError(400, "不能补录加入系统之前的考勤");
    const reason = safeText(value?.reason, 500);
    if (!reason) throw httpError(400, "修正原因不能为空");
    const nextValue = {
      clock_in_at: normalizeDateTime(value?.clockInAt),
      clock_out_at: normalizeDateTime(value?.clockOutAt),
      checkout_note: safeText(value?.checkoutNote, 2000)
    };
    if (!previous && !nextValue.clock_in_at) throw httpError(400, "补录考勤请填写上班时间");
    if (nextValue.clock_out_at && !nextValue.clock_in_at) throw httpError(400, "填写退勤时间前请先填写上班时间");
    for (const time of [nextValue.clock_in_at, nextValue.clock_out_at]) {
      if (time && appDate(new Date(time)) !== attendanceDate) throw httpError(400, "打卡时间必须属于所选日期（程序时区）");
    }
    if (nextValue.clock_in_at && nextValue.clock_out_at && nextValue.clock_out_at < nextValue.clock_in_at) {
      throw httpError(400, "退勤时间不能早于上班时间");
    }
    const now = appDateTime();
    let recordId = previous?.id;
    if (previous) {
      db.prepare("UPDATE attendance SET clock_in_at = ?, clock_out_at = ?, checkout_note = ?, updated_at = ? WHERE id = ?")
        .run(nextValue.clock_in_at, nextValue.clock_out_at, nextValue.checkout_note, now, recordId);
    } else {
      recordId = Number(db.prepare(`INSERT INTO attendance (employee_id, attendance_date, clock_in_at, clock_out_at, checkout_note, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(targetEmployeeId, attendanceDate, nextValue.clock_in_at, nextValue.clock_out_at, nextValue.checkout_note, now).lastInsertRowid);
    }
    const result = db.prepare("SELECT * FROM attendance WHERE id = ?").get(recordId);
    db.prepare(`INSERT INTO attendance_corrections (attendance_id, before_json, after_json, reason, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(recordId, JSON.stringify(previous || null), JSON.stringify(result), reason, now);
    audit(previous ? "correct" : "create", "attendance", recordId, reason);
    return result;
  })();
}
