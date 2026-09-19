import { db, setting } from "./db.js";
import { weekdayForDate } from "./utils.js";
import { attendanceSummary, enrichAttendanceRows } from "./attendanceTiming.js";

const latestVersionsForDate = db.prepare(`
  SELECT version.*
  FROM default_task_versions version
  JOIN (
    SELECT task_key, MAX(effective_from) AS effective_from
    FROM default_task_versions
    WHERE effective_from <= ?
    GROUP BY task_key
  ) latest
    ON latest.task_key = version.task_key
   AND latest.effective_from = version.effective_from
  WHERE version.is_active = 1
`);

export function activeDefaultTasksForDate(date, employeeId = null) {
  const weekday = weekdayForDate(date);
  return latestVersionsForDate
    .all(date)
    .filter((row) => (!employeeId || row.employee_id === employeeId))
    .filter((row) => JSON.parse(row.weekdays).includes(weekday));
}

export function latestTemplateVersions(employeeId) {
  return db
    .prepare(
      `SELECT version.*
       FROM default_task_versions version
       JOIN (
         SELECT task_key, MAX(effective_from) AS effective_from
         FROM default_task_versions
         WHERE employee_id = ?
         GROUP BY task_key
       ) latest
         ON latest.task_key = version.task_key
        AND latest.effective_from = version.effective_from
       WHERE version.employee_id = ?
       ORDER BY version.start_hour, version.end_hour, version.id`
    )
    .all(employeeId, employeeId)
    .map(mapTemplate);
}

export function buildDaySchedule(date, { includeInactive = false, currentEmployeeId = null } = {}) {
  const employees = db
    .prepare(
      `SELECT id, name, position, active, display_order
       FROM employees
       ${includeInactive ? "" : "WHERE active = 1"}
       ORDER BY display_order, id`
    )
    .all();

  const holiday = db
    .prepare("SELECT id, holiday_date, name FROM holidays WHERE holiday_date = ?")
    .get(date);

  const defaultRows = holiday ? [] : activeDefaultTasksForDate(date);
  const overrides = new Map(
    db
      .prepare("SELECT * FROM daily_task_overrides WHERE task_date = ?")
      .all(date)
      .map((row) => [row.task_key, row])
  );
  const additions = db
    .prepare(
      `SELECT * FROM additional_tasks
       WHERE task_date = ?
       ORDER BY employee_id, start_hour, end_hour, id`
    )
    .all(date);
  const attendanceRows = new Map(
    enrichAttendanceRows(db
      .prepare("SELECT * FROM attendance WHERE attendance_date = ?")
      .all(date))
      .map((row) => [row.employee_id, row])
  );

  const taskMap = new Map(employees.map((employee) => [employee.id, []]));
  for (const row of defaultRows) {
    const override = overrides.get(row.task_key);
    const task = {
      id: `default:${row.task_key}`,
      taskKey: row.task_key,
      source: override ? "override" : "default",
      employeeId: row.employee_id,
      title: override?.title ?? row.title,
      descriptionHtml: override?.description_html ?? row.description_html,
      startHour: row.start_hour,
      endHour: row.end_hour,
      effectiveFrom: row.effective_from
    };
    taskMap.get(row.employee_id)?.push(task);
  }
  for (const row of additions) {
    taskMap.get(row.employee_id)?.push({
      id: `additional:${row.id}`,
      additionalTaskId: row.id,
      source: "additional",
      employeeId: row.employee_id,
      title: row.title,
      descriptionHtml: row.description_html,
      startHour: row.start_hour,
      endHour: row.end_hour
    });
  }

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const tasks of taskMap.values()) {
    for (const task of tasks) {
      earliest = Math.min(earliest, task.startHour);
      latest = Math.max(latest, task.endHour);
    }
  }
  if (!Number.isFinite(earliest)) {
    earliest = Number(setting("fallback_start_hour", "9"));
    latest = Number(setting("fallback_end_hour", "18"));
  }

  return {
    date,
    holiday: holiday ?? null,
    range: { startHour: earliest, endHour: latest },
    employees: employees.map((employee) => {
      const attendance = attendanceRows.get(employee.id);
      const isCurrent = employee.id === currentEmployeeId;
      return {
        ...employee,
        active: Boolean(employee.active),
        isCurrent,
        tasks: (taskMap.get(employee.id) ?? []).sort(
          (a, b) => a.startHour - b.startHour || a.endHour - b.endHour
        ),
        attendance: {
          status: attendanceSummary(attendance).status,
          ...(isCurrent
            ? {
                ...attendanceSummary(attendance)
              }
            : {})
        }
      };
    })
  };
}

export function mapTemplate(row) {
  return {
    id: row.id,
    taskKey: row.task_key,
    employeeId: row.employee_id,
    title: row.title,
    descriptionHtml: row.description_html,
    startHour: row.start_hour,
    endHour: row.end_hour,
    weekdays: JSON.parse(row.weekdays),
    effectiveFrom: row.effective_from,
    active: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
