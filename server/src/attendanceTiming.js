import { audit, db } from "./db.js";
import { appDate, appDateTime, hashToken, httpError, safeText } from "./utils.js";

// Intersect breaks with the corrected work window and merge overlaps. Never
// invent a clock-out: the last pause provides a separate, confirmed cutoff.
// If work resumed but no checkout followed, the subsequent time is unconfirmed.
export function calculateAttendanceTime(record, pauses) {
  const lastPause = pauses.reduce((last, pause) => !last || Date.parse(pause.paused_at) > Date.parse(last.paused_at) ? pause : last, null);
  const cutoff = record.clock_out_at || lastPause?.paused_at || null;
  if (!record.clock_in_at || !cutoff) return { work_seconds: null, pause_seconds: null, work_ended_at: null };
  const start = Date.parse(record.clock_in_at);
  const end = Math.max(start, Date.parse(cutoff));
  const intervals = pauses.map(pause => [
    Math.max(start, Date.parse(pause.paused_at)),
    Math.min(end, pause.resumed_at ? Date.parse(pause.resumed_at) : end)
  ]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let excluded = 0;
  let lastEnd = start;
  for (const [a, b] of intervals) {
    excluded += Math.max(0, b - Math.max(a, lastEnd));
    lastEnd = Math.max(lastEnd, b);
  }
  return { work_seconds: (end - start - excluded) / 1000, pause_seconds: excluded / 1000, work_ended_at: cutoff };
}

export function enrichAttendanceRows(rows) {
  const groups = new Map();
  // Bound parameter counts for long history exports, without one query per day.
  for (let i = 0; i < rows.length; i += 400) {
    const ids = rows.slice(i, i + 400).map(row => row.id);
    const pauses = db.prepare(`SELECT * FROM attendance_pauses WHERE attendance_id IN (${ids.map(() => "?").join(",")}) ORDER BY paused_at, id`).all(...ids);
    for (const pause of pauses) {
      if (!groups.has(pause.attendance_id)) groups.set(pause.attendance_id, []);
      groups.get(pause.attendance_id).push(pause);
    }
  }
  return rows.map(row => {
    const pauses = groups.get(row.id) || [];
    return {
      ...row, pauses,
      paused_at: row.clock_in_at && !row.clock_out_at ? pauses.find(p => !p.resumed_at)?.paused_at || null : null,
      pause_revision: hashToken(JSON.stringify([row.clock_in_at, row.clock_out_at, row.updated_at, pauses])),
      ...calculateAttendanceTime(row, pauses)
    };
  });
}

export function attendanceSummary(row) {
  return {
    status: !row?.clock_in_at ? "not_started" : row.clock_out_at ? "checked_out" : row.paused_at ? "paused" : "working",
    clockInAt: row?.clock_in_at ?? null,
    clockOutAt: row?.clock_out_at ?? null,
    checkoutNote: row?.checkout_note ?? "",
    pausedAt: row?.paused_at ?? null,
    pauseRevision: row?.pause_revision ?? ""
  };
}

export function changeAttendanceState({ employeeId, date, action, revision, note, now = new Date() }) {
  const today = appDate(now);
  if (date !== today) throw httpError(409, "日期已变化，请手动刷新页面后再操作", "ATTENDANCE_DATE_CHANGED");
  if (!["pause", "resume", "checkout"].includes(action)) throw httpError(400, "无效的考勤操作");
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM attendance WHERE employee_id = ? AND attendance_date = ?").get(employeeId, today);
    if (!row?.clock_in_at) throw httpError(409, "尚无上班记录，请手动刷新页面后再操作");
    const [current] = enrichAttendanceRows([row]);
    const time = appDateTime(now);
    if (row.clock_out_at) return { alreadyCheckedOut: true, attendance: current, summary: attendanceSummary(current) };
    const desiredAlreadySet = action === "pause" ? Boolean(current.paused_at) : action === "resume" ? !current.paused_at : false;
    if (action !== "checkout" && revision !== current.pause_revision && !desiredAlreadySet) {
      const error = httpError(409, "考勤状态已在其他页面或设备更新，请确认当前状态后重试", "ATTENDANCE_STATE_CHANGED");
      error.summary = attendanceSummary(current);
      throw error;
    }
    if (!desiredAlreadySet) {
      const last = current.pauses.at(-1);
      const latestEvent = last?.resumed_at || last?.paused_at || row.clock_in_at;
      if (Date.parse(time) < Math.max(Date.parse(latestEvent), Date.parse(row.clock_in_at))) {
        throw httpError(409, "当前时间早于已有考勤时间，请联系管理员检查时间设置");
      }
      if (action === "pause") {
        db.prepare("INSERT INTO attendance_pauses (attendance_id, paused_at) VALUES (?, ?)").run(row.id, time);
      } else if (action === "resume") {
        db.prepare("UPDATE attendance_pauses SET resumed_at = ? WHERE attendance_id = ? AND resumed_at IS NULL").run(time, row.id);
      } else {
        db.prepare("UPDATE attendance SET clock_out_at = ?, checkout_note = ? WHERE id = ?")
          .run(time, safeText(note, 2000), row.id);
      }
      db.prepare("UPDATE attendance SET updated_at = ? WHERE id = ?").run(time, row.id);
      audit(action, "attendance", row.id, time);
    }
    const [attendance] = enrichAttendanceRows([db.prepare("SELECT * FROM attendance WHERE id = ?").get(row.id)]);
    return { alreadyCheckedOut: false, attendance, summary: attendanceSummary(attendance) };
  })();
}
