import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import ExcelJS from "exceljs";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { config } from "./config.js";
import { audit, db, setting } from "./db.js";
import {
  canReadMedia,
  clearAdminSession,
  createAdminSession,
  getAdmin,
  issueDeviceCookie,
  requireAdmin,
  requireDevice
} from "./auth.js";
import {
  activeDefaultTasksForDate,
  buildDaySchedule,
  latestTemplateVersions
} from "./schedule.js";
import {
  TIME_ZONE_OPTIONS,
  appDate,
  appDateTime,
  asBoolean,
  cleanRichText,
  formatAppDateTime,
  getDisplayTimeZone,
  getServerTimeZone,
  hashToken,
  httpError,
  parseDate,
  randomId,
  safeText,
  setTimeZoneConfig,
  validateTimeZone,
  validateTimeRange,
  validateWeekdays,
  zonedLocalDateTimeToIso
} from "./utils.js";

const app = express();
if (config.trustProxy) app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-origin" },
    contentSecurityPolicy: false
  })
);
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.uploadDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase().slice(0, 10);
      callback(null, `${randomId()}${extension}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    callback(allowed.has(file.mimetype) ? null : httpError(400, "仅支持 PNG、JPG、WEBP 或 GIF 图片"), allowed.has(file.mimetype));
  }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireString(value, name, max = 100) {
  const result = safeText(value, max);
  if (!result) throw httpError(400, `${name}不能为空`);
  return result;
}

function normalizeDateTime(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) {
    return zonedLocalDateTimeToIso(text);
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw httpError(400, "日期时间格式无效");
  return date.toISOString();
}

function adminLog(action, entityType, entityId, detail = "") {
  audit(action, entityType, entityId, detail);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: appDateTime(),
    serverTimeZone: getServerTimeZone(),
    displayTimeZone: getDisplayTimeZone()
  });
});

app.get("/api/app-config", (_req, res) => {
  res.json({ displayTimeZone: getDisplayTimeZone() });
});

app.get("/api/front/today", (req, res, next) => {
  try {
    const deviceCode = safeText(req.get("x-device-code"), 160);
    if (!deviceCode || deviceCode.length < 8) {
      throw httpError(400, "设备码无效", "INVALID_DEVICE_CODE");
    }
    const now = appDateTime();
    db.prepare(
      `INSERT INTO devices (
         device_code, enabled, first_seen_at, last_seen_at, updated_at
       ) VALUES (?, 0, ?, ?, ?)
       ON CONFLICT(device_code) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`
    ).run(deviceCode, now, now, now);

    const device = db
      .prepare(
        `SELECT devices.*, employees.active, employees.name AS employee_name
         FROM devices
         LEFT JOIN employees ON employees.id = devices.employee_id
         WHERE devices.device_code = ?`
      )
      .get(deviceCode);
    if (!device.enabled || !device.employee_id || !device.active) {
      return res.status(403).json({
        code: "DEVICE_PENDING",
        message: "当前设备尚未授权，请联系管理员绑定员工",
        deviceCode,
        firstSeenAt: device.first_seen_at
      });
    }

    issueDeviceCookie(res, device);
    const today = appDate();
    db.prepare(
      `INSERT INTO attendance (
         employee_id, attendance_date, clock_in_at, source_device_id, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, attendance_date) DO NOTHING`
    ).run(device.employee_id, today, now, device.id, now);

    res.json({
      displayTimeZone: getDisplayTimeZone(),
      device: {
        id: device.id,
        label: device.label,
        employeeId: device.employee_id
      },
      schedule: buildDaySchedule(today, { currentEmployeeId: device.employee_id })
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/front/checkout", requireDevice, (req, res, next) => {
  try {
    const today = appDate();
    const now = appDateTime();
    const note = String(req.body?.note ?? "").trim().slice(0, 2000);
    db.prepare(
      `INSERT INTO attendance (
         employee_id, attendance_date, clock_in_at, source_device_id, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(employee_id, attendance_date) DO NOTHING`
    ).run(req.device.employee_id, today, now, req.device.id, now);
    const result = db.prepare(
      `UPDATE attendance
       SET clock_out_at = ?, checkout_note = ?, updated_at = ?
       WHERE employee_id = ? AND attendance_date = ? AND clock_out_at IS NULL`
    ).run(now, note, now, req.device.employee_id, today);
    const attendance = db
      .prepare("SELECT * FROM attendance WHERE employee_id = ? AND attendance_date = ?")
      .get(req.device.employee_id, today);
    res.json({ alreadyCheckedOut: result.changes === 0, attendance });
  } catch (error) {
    next(error);
  }
});

app.get("/api/media/:id", (req, res, next) => {
  try {
    if (!canReadMedia(req)) throw httpError(403, "无权查看图片");
    const file = db.prepare("SELECT * FROM media_files WHERE id = ?").get(req.params.id);
    if (!file) throw httpError(404, "图片不存在");
    const filePath = path.join(config.uploadDir, file.stored_name);
    if (!fs.existsSync(filePath)) throw httpError(404, "图片文件不存在");
    res.type(file.mime_type).set("Cache-Control", "private, max-age=86400").sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/login", asyncRoute(async (req, res) => {
  const username = safeText(req.body?.username, 80);
  const password = String(req.body?.password ?? "");
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    throw httpError(401, "用户名或密码错误");
  }
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  createAdminSession(res, admin.id);
  adminLog("login", "admin", admin.id);
  res.json({
    admin: {
      id: admin.id,
      username: admin.username,
      mustChangePassword: Boolean(admin.must_change_password)
    }
  });
}));

app.post("/api/admin/logout", (req, res) => {
  clearAdminSession(req, res);
  res.json({ ok: true });
});

app.get("/api/admin/me", (req, res) => {
  const admin = getAdmin(req);
  if (!admin) return res.status(401).json({ message: "请先登录" });
  res.json({ admin });
});

app.put("/api/admin/password", requireAdmin, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  if (newPassword.length < 8) throw httpError(400, "新密码至少需要 8 位");
  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id);
  if (!(await bcrypt.compare(currentPassword, admin.password_hash))) {
    throw httpError(400, "当前密码不正确");
  }
  const now = appDateTime();
  db.prepare(
    `UPDATE admins
     SET password_hash = ?, must_change_password = 0, updated_at = ?
     WHERE id = ?`
  ).run(await bcrypt.hash(newPassword, 12), now, admin.id);
  db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").run(admin.id);
  createAdminSession(res, admin.id);
  adminLog("password_change", "admin", admin.id);
  res.json({ ok: true });
}));

app.use("/api/admin", requireAdmin);

app.get("/api/admin/dashboard", (_req, res) => {
  const today = appDate();
  const counts = {
    employees: db.prepare("SELECT COUNT(*) AS count FROM employees WHERE active = 1").get().count,
    pendingDevices: db.prepare("SELECT COUNT(*) AS count FROM devices WHERE enabled = 0 OR employee_id IS NULL").get().count,
    working: db.prepare("SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND clock_in_at IS NOT NULL AND clock_out_at IS NULL").get(today).count,
    checkedOut: db.prepare("SELECT COUNT(*) AS count FROM attendance WHERE attendance_date = ? AND clock_out_at IS NOT NULL").get(today).count
  };
  res.json({ date: today, counts, schedule: buildDaySchedule(today) });
});

app.get("/api/admin/employees", (_req, res) => {
  const employees = db
    .prepare(
      `SELECT employees.*,
        (SELECT COUNT(*) FROM devices WHERE devices.employee_id = employees.id AND devices.enabled = 1) AS device_count
       FROM employees
       ORDER BY display_order, id`
    )
    .all()
    .map((row) => ({ ...row, active: Boolean(row.active) }));
  res.json({ employees });
});

app.post("/api/admin/employees", (req, res, next) => {
  try {
    const name = requireString(req.body?.name, "员工姓名", 80);
    const position = safeText(req.body?.position, 100);
    const now = appDateTime();
    const nextOrder = db.prepare("SELECT COALESCE(MAX(display_order), 0) + 1 AS value FROM employees").get().value;
    const result = db.prepare(
      `INSERT INTO employees (name, position, active, display_order, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    ).run(name, position, nextOrder, now, now);
    adminLog("create", "employee", result.lastInsertRowid, name);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/employees/:id", (req, res, next) => {
  try {
    const employee = db.prepare("SELECT * FROM employees WHERE id = ?").get(req.params.id);
    if (!employee) throw httpError(404, "员工不存在");
    const name = requireString(req.body?.name, "员工姓名", 80);
    const position = safeText(req.body?.position, 100);
    const active = asBoolean(req.body?.active) ? 1 : 0;
    const now = appDateTime();
    db.prepare(
      `UPDATE employees SET name = ?, position = ?, active = ?, updated_at = ? WHERE id = ?`
    ).run(name, position, active, now, employee.id);
    adminLog("update", "employee", employee.id, name);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/employees/reorder", (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (!ids.length) throw httpError(400, "员工顺序不能为空");
    const update = db.prepare("UPDATE employees SET display_order = ?, updated_at = ? WHERE id = ?");
    const now = appDateTime();
    db.transaction(() => ids.forEach((id, index) => update.run(index + 1, now, id)))();
    adminLog("reorder", "employee", null, ids.join(","));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/employees/:id/templates", (req, res, next) => {
  try {
    const employee = db.prepare("SELECT id FROM employees WHERE id = ?").get(req.params.id);
    if (!employee) throw httpError(404, "员工不存在");
    res.json({ templates: latestTemplateVersions(employee.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/employees/:id/templates", (req, res, next) => {
  try {
    const employee = db.prepare("SELECT id FROM employees WHERE id = ?").get(req.params.id);
    if (!employee) throw httpError(404, "员工不存在");
    const title = requireString(req.body?.title, "任务标题", 120);
    const description = cleanRichText(req.body?.descriptionHtml);
    const { startHour, endHour } = validateTimeRange(req.body?.startHour, req.body?.endHour);
    const weekdays = validateWeekdays(req.body?.weekdays);
    const effectiveFrom = parseDate(req.body?.effectiveFrom ?? appDate());
    const taskKey = randomId();
    const now = appDateTime();
    db.prepare(
      `INSERT INTO default_task_versions (
         task_key, employee_id, title, description_html, start_hour, end_hour,
         weekdays, effective_from, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      taskKey,
      employee.id,
      title,
      description,
      startHour,
      endHour,
      JSON.stringify(weekdays),
      effectiveFrom,
      now,
      now
    );
    adminLog("create", "default_task", taskKey, title);
    res.status(201).json({ taskKey });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/templates/:taskKey", (req, res, next) => {
  try {
    const previous = db
      .prepare(
        `SELECT * FROM default_task_versions
         WHERE task_key = ?
         ORDER BY effective_from DESC, id DESC LIMIT 1`
      )
      .get(req.params.taskKey);
    if (!previous) throw httpError(404, "默认任务不存在");
    const title = requireString(req.body?.title, "任务标题", 120);
    const description = cleanRichText(req.body?.descriptionHtml);
    const { startHour, endHour } = validateTimeRange(req.body?.startHour, req.body?.endHour);
    const weekdays = validateWeekdays(req.body?.weekdays);
    const effectiveFrom = parseDate(req.body?.effectiveFrom ?? appDate());
    const now = appDateTime();
    db.prepare(
      `INSERT INTO default_task_versions (
         task_key, employee_id, title, description_html, start_hour, end_hour,
         weekdays, effective_from, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(task_key, effective_from) DO UPDATE SET
         title = excluded.title,
         description_html = excluded.description_html,
         start_hour = excluded.start_hour,
         end_hour = excluded.end_hour,
         weekdays = excluded.weekdays,
         is_active = 1,
         updated_at = excluded.updated_at`
    ).run(
      previous.task_key,
      previous.employee_id,
      title,
      description,
      startHour,
      endHour,
      JSON.stringify(weekdays),
      effectiveFrom,
      now,
      now
    );
    adminLog("update", "default_task", previous.task_key, `${effectiveFrom}:${title}`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/templates/:taskKey", (req, res, next) => {
  try {
    const previous = db
      .prepare(
        `SELECT * FROM default_task_versions
         WHERE task_key = ?
         ORDER BY effective_from DESC, id DESC LIMIT 1`
      )
      .get(req.params.taskKey);
    if (!previous) throw httpError(404, "默认任务不存在");
    const effectiveFrom = parseDate(req.query.effectiveFrom ?? appDate());
    const now = appDateTime();
    db.prepare(
      `INSERT INTO default_task_versions (
         task_key, employee_id, title, description_html, start_hour, end_hour,
         weekdays, effective_from, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(task_key, effective_from) DO UPDATE SET
         is_active = 0, updated_at = excluded.updated_at`
    ).run(
      previous.task_key,
      previous.employee_id,
      previous.title,
      previous.description_html,
      previous.start_hour,
      previous.end_hour,
      previous.weekdays,
      effectiveFrom,
      now,
      now
    );
    adminLog("delete", "default_task", previous.task_key, effectiveFrom);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/devices", (_req, res) => {
  const devices = db
    .prepare(
      `SELECT devices.*, employees.name AS employee_name, employees.position
       FROM devices
       LEFT JOIN employees ON employees.id = devices.employee_id
       ORDER BY
         CASE WHEN devices.enabled = 0 OR devices.employee_id IS NULL THEN 0 ELSE 1 END,
         devices.last_seen_at DESC`
    )
    .all()
    .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  res.json({ devices });
});

app.post("/api/admin/devices/register-current", (req, res, next) => {
  try {
    const deviceCode = safeText(req.body?.deviceCode, 160);
    if (!deviceCode || deviceCode.length < 8) throw httpError(400, "设备码无效");
    const now = appDateTime();
    db.prepare(
      `INSERT INTO devices (
         device_code, enabled, first_seen_at, last_seen_at, updated_at
       ) VALUES (?, 0, ?, ?, ?)
       ON CONFLICT(device_code) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         updated_at = excluded.updated_at`
    ).run(deviceCode, now, now, now);
    const device = db.prepare("SELECT * FROM devices WHERE device_code = ?").get(deviceCode);
    res.json({ device });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/devices/:id/bind", (req, res, next) => {
  try {
    const employeeId = Number(req.body?.employeeId);
    const employee = db.prepare("SELECT * FROM employees WHERE id = ? AND active = 1").get(employeeId);
    if (!employee) throw httpError(404, "在职员工不存在");
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(req.params.id);
    if (!device) throw httpError(404, "设备不存在");
    const label = safeText(req.body?.label, 120) || `${employee.name}的设备`;
    const now = appDateTime();
    db.prepare(
      `UPDATE devices
       SET employee_id = ?, label = ?, enabled = 1, authorized_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(employee.id, label, now, now, device.id);
    adminLog("bind", "device", device.id, `${employee.name}:${label}`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/devices/:id/unbind", (req, res, next) => {
  try {
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(req.params.id);
    if (!device) throw httpError(404, "设备不存在");
    db.prepare(
      `UPDATE devices SET employee_id = NULL, enabled = 0, authorized_at = NULL, updated_at = ?
       WHERE id = ?`
    ).run(appDateTime(), device.id);
    adminLog("unbind", "device", device.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/devices/:id", (req, res, next) => {
  try {
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(req.params.id);
    if (!device) throw httpError(404, "设备不存在");
    db.prepare("DELETE FROM devices WHERE id = ?").run(device.id);
    adminLog("delete", "device", device.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/schedule", (req, res, next) => {
  try {
    const date = parseDate(req.query.date ?? appDate());
    res.json({ schedule: buildDaySchedule(date) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/schedule/:date/default/:taskKey", (req, res, next) => {
  try {
    const date = parseDate(req.params.date);
    const base = activeDefaultTasksForDate(date).find((row) => row.task_key === req.params.taskKey);
    if (!base) throw httpError(404, "该日期没有此默认任务");
    const title = requireString(req.body?.title, "任务标题", 120);
    const description = cleanRichText(req.body?.descriptionHtml);
    const now = appDateTime();
    db.prepare(
      `INSERT INTO daily_task_overrides (
         task_key, employee_id, task_date, title, description_html, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_key, task_date) DO UPDATE SET
         title = excluded.title,
         description_html = excluded.description_html,
         updated_at = excluded.updated_at`
    ).run(base.task_key, base.employee_id, date, title, description, now, now);
    adminLog("override", "daily_default_task", base.task_key, `${date}:${title}`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/schedule/:date/tasks", (req, res, next) => {
  try {
    const date = parseDate(req.params.date);
    const employeeId = Number(req.body?.employeeId);
    const employee = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
    if (!employee) throw httpError(404, "在职员工不存在");
    const title = requireString(req.body?.title, "任务标题", 120);
    const description = cleanRichText(req.body?.descriptionHtml);
    const { startHour, endHour } = validateTimeRange(req.body?.startHour, req.body?.endHour);
    const now = appDateTime();
    const result = db.prepare(
      `INSERT INTO additional_tasks (
         employee_id, task_date, title, description_html, start_hour, end_hour,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(employeeId, date, title, description, startHour, endHour, now, now);
    adminLog("create", "additional_task", result.lastInsertRowid, `${date}:${title}`);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/tasks/:id", (req, res, next) => {
  try {
    const task = db.prepare("SELECT * FROM additional_tasks WHERE id = ?").get(req.params.id);
    if (!task) throw httpError(404, "新增任务不存在");
    const employeeId = Number(req.body?.employeeId ?? task.employee_id);
    const employee = db.prepare("SELECT id FROM employees WHERE id = ? AND active = 1").get(employeeId);
    if (!employee) throw httpError(404, "在职员工不存在");
    const title = requireString(req.body?.title, "任务标题", 120);
    const description = cleanRichText(req.body?.descriptionHtml);
    const { startHour, endHour } = validateTimeRange(req.body?.startHour, req.body?.endHour);
    db.prepare(
      `UPDATE additional_tasks
       SET employee_id = ?, title = ?, description_html = ?, start_hour = ?, end_hour = ?, updated_at = ?
       WHERE id = ?`
    ).run(employeeId, title, description, startHour, endHour, appDateTime(), task.id);
    adminLog("update", "additional_task", task.id, title);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/tasks/:id", (req, res, next) => {
  try {
    const task = db.prepare("SELECT id FROM additional_tasks WHERE id = ?").get(req.params.id);
    if (!task) throw httpError(404, "新增任务不存在");
    db.prepare("DELETE FROM additional_tasks WHERE id = ?").run(task.id);
    adminLog("delete", "additional_task", task.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/holidays", (req, res, next) => {
  try {
    const start = req.query.start ? parseDate(req.query.start) : "1900-01-01";
    const end = req.query.end ? parseDate(req.query.end) : "2999-12-31";
    const holidays = db
      .prepare("SELECT * FROM holidays WHERE holiday_date BETWEEN ? AND ? ORDER BY holiday_date")
      .all(start, end);
    res.json({ holidays });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/holidays", (req, res, next) => {
  try {
    const date = parseDate(req.body?.date);
    const name = safeText(req.body?.name, 100) || "全员休息日";
    const now = appDateTime();
    db.prepare(
      `INSERT INTO holidays (holiday_date, name, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(holiday_date) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
    ).run(date, name, now, now);
    adminLog("upsert", "holiday", date, name);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/holidays/:date", (req, res, next) => {
  try {
    const date = parseDate(req.params.date);
    db.prepare("DELETE FROM holidays WHERE holiday_date = ?").run(date);
    adminLog("delete", "holiday", date);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/attendance", (req, res, next) => {
  try {
    const start = parseDate(req.query.start ?? appDate());
    const end = parseDate(req.query.end ?? start);
    const employeeId = Number(req.query.employeeId ?? 0);
    const rows = db
      .prepare(
        `SELECT attendance.*, employees.name, employees.position
         FROM attendance
         JOIN employees ON employees.id = attendance.employee_id
         WHERE attendance.attendance_date BETWEEN ? AND ?
           AND (? = 0 OR attendance.employee_id = ?)
         ORDER BY attendance.attendance_date DESC, employees.display_order, employees.id`
      )
      .all(start, end, employeeId, employeeId);
    res.json({ attendance: rows });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/attendance/:id", (req, res, next) => {
  try {
    const previous = db.prepare("SELECT * FROM attendance WHERE id = ?").get(req.params.id);
    if (!previous) throw httpError(404, "考勤记录不存在");
    const reason = requireString(req.body?.reason, "修正原因", 500);
    const nextValue = {
      clock_in_at: normalizeDateTime(req.body?.clockInAt),
      clock_out_at: normalizeDateTime(req.body?.clockOutAt),
      checkout_note: String(req.body?.checkoutNote ?? "").trim().slice(0, 2000)
    };
    if (
      nextValue.clock_in_at &&
      nextValue.clock_out_at &&
      new Date(nextValue.clock_out_at) < new Date(nextValue.clock_in_at)
    ) {
      throw httpError(400, "退勤时间不能早于上班时间");
    }
    const now = appDateTime();
    db.transaction(() => {
      db.prepare(
        `UPDATE attendance
         SET clock_in_at = ?, clock_out_at = ?, checkout_note = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        nextValue.clock_in_at,
        nextValue.clock_out_at,
        nextValue.checkout_note,
        now,
        previous.id
      );
      db.prepare(
        `INSERT INTO attendance_corrections (
           attendance_id, before_json, after_json, reason, created_at
         ) VALUES (?, ?, ?, ?, ?)`
      ).run(previous.id, JSON.stringify(previous), JSON.stringify(nextValue), reason, now);
    })();
    adminLog("correct", "attendance", previous.id, reason);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/attendance/export.xlsx", asyncRoute(async (req, res) => {
  const start = parseDate(req.query.start ?? appDate());
  const end = parseDate(req.query.end ?? start);
  const employeeId = Number(req.query.employeeId ?? 0);
  const rows = db
    .prepare(
      `SELECT attendance.*, employees.name, employees.position
       FROM attendance
       JOIN employees ON employees.id = attendance.employee_id
       WHERE attendance.attendance_date BETWEEN ? AND ?
         AND (? = 0 OR attendance.employee_id = ?)
       ORDER BY employees.display_order, employees.id, attendance.attendance_date`
    )
    .all(start, end, employeeId, employeeId);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("考勤记录");
  const displayTimeZoneLabel = TIME_ZONE_OPTIONS[getDisplayTimeZone()].label;
  sheet.columns = [
    { header: "日期", key: "date", width: 14 },
    { header: "员工", key: "name", width: 14 },
    { header: "岗位", key: "position", width: 18 },
    { header: `上班时间（${displayTimeZoneLabel}）`, key: "clockIn", width: 24 },
    { header: `退勤时间（${displayTimeZoneLabel}）`, key: "clockOut", width: 24 },
    { header: "工作时长（小时）", key: "duration", width: 18 },
    { header: "状态", key: "status", width: 14 },
    { header: "退勤说明", key: "note", width: 40 }
  ];
  for (const row of rows) {
    const duration =
      row.clock_in_at && row.clock_out_at
        ? Math.max(
            0,
            (new Date(row.clock_out_at).getTime() - new Date(row.clock_in_at).getTime()) / 3600000
          )
        : null;
    sheet.addRow({
      date: row.attendance_date,
      name: row.name,
      position: row.position,
      clockIn: formatAppDateTime(row.clock_in_at),
      clockOut: formatAppDateTime(row.clock_out_at),
      duration: duration == null ? "" : Number(duration.toFixed(2)),
      status: !row.clock_in_at ? "未打卡" : row.clock_out_at ? "已退勤" : "缺少退勤",
      note: row.checkout_note
    });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0E5B4E" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  res
    .set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .set("Content-Disposition", `attachment; filename=\"attendance-${start}-${end}.xlsx\"`)
    .send(Buffer.from(buffer));
}));

app.get("/api/admin/settings", (_req, res) => {
  res.json({
    settings: {
      fallbackStartHour: Number(setting("fallback_start_hour", "9")),
      fallbackEndHour: Number(setting("fallback_end_hour", "18")),
      serverTimeZone: setting("server_timezone", "Asia/Shanghai"),
      displayTimeZone: setting("display_timezone", "Asia/Tokyo")
    },
    timeZoneOptions: Object.entries(TIME_ZONE_OPTIONS).map(([value, option]) => ({
      value,
      label: option.label
    }))
  });
});

app.put("/api/admin/settings", (req, res, next) => {
  try {
    const { startHour, endHour } = validateTimeRange(
      req.body?.fallbackStartHour,
      req.body?.fallbackEndHour
    );
    const serverTimeZone = validateTimeZone(req.body?.serverTimeZone, "服务器时区");
    const displayTimeZone = validateTimeZone(req.body?.displayTimeZone, "程序显示时区");
    const now = appDateTime();
    const upsert = db.prepare(
      `INSERT INTO settings (setting_key, setting_value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(setting_key) DO UPDATE SET
         setting_value = excluded.setting_value,
         updated_at = excluded.updated_at`
    );
    db.transaction(() => {
      upsert.run("fallback_start_hour", String(startHour), now);
      upsert.run("fallback_end_hour", String(endHour), now);
      upsert.run("server_timezone", serverTimeZone, now);
      upsert.run("display_timezone", displayTimeZone, now);
    })();
    setTimeZoneConfig(serverTimeZone, displayTimeZone);
    adminLog(
      "update",
      "settings",
      null,
      JSON.stringify({ startHour, endHour, serverTimeZone, displayTimeZone })
    );
    res.json({ ok: true, displayTimeZone });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/upload-image", upload.single("image"), (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, "请选择图片");
    const id = randomId();
    db.prepare(
      `INSERT INTO media_files (
         id, original_name, stored_name, mime_type, size, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      safeText(req.file.originalname, 240),
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      appDateTime()
    );
    adminLog("upload", "media", id, req.file.originalname);
    res.status(201).json({ id, url: `/api/media/${id}` });
  } catch (error) {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    next(error);
  }
});

function purgeFilter(body) {
  const start = parseDate(body?.start);
  const end = parseDate(body?.end);
  if (start > end) throw httpError(400, "开始日期不能晚于结束日期");
  const employeeIds = Array.isArray(body?.employeeIds)
    ? [...new Set(body.employeeIds.map(Number).filter(Number.isInteger))]
    : [];
  if (!employeeIds.length) throw httpError(400, "至少选择一名员工");
  const dataTypes = Array.isArray(body?.dataTypes)
    ? body.dataTypes.filter((type) =>
        ["attendance", "additionalTasks", "dailyOverrides"].includes(type)
      )
    : [];
  if (!dataTypes.length) throw httpError(400, "至少选择一种历史数据");
  return { start, end, employeeIds, dataTypes };
}

function purgeCounts(filter) {
  const placeholders = filter.employeeIds.map(() => "?").join(",");
  const parameters = [filter.start, filter.end, ...filter.employeeIds];
  return {
    attendance: db
      .prepare(
        `SELECT COUNT(*) AS count FROM attendance
         WHERE attendance_date BETWEEN ? AND ? AND employee_id IN (${placeholders})`
      )
      .get(...parameters).count,
    additionalTasks: db
      .prepare(
        `SELECT COUNT(*) AS count FROM additional_tasks
         WHERE task_date BETWEEN ? AND ? AND employee_id IN (${placeholders})`
      )
      .get(...parameters).count,
    dailyOverrides: db
      .prepare(
        `SELECT COUNT(*) AS count FROM daily_task_overrides
         WHERE task_date BETWEEN ? AND ? AND employee_id IN (${placeholders})`
      )
      .get(...parameters).count
  };
}

app.post("/api/admin/purge/preview", (req, res, next) => {
  try {
    const filter = purgeFilter(req.body);
    const allCounts = purgeCounts(filter);
    const counts = Object.fromEntries(
      Object.entries(allCounts).filter(([key]) => filter.dataTypes.includes(key))
    );
    res.json({ counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/purge/execute", asyncRoute(async (req, res) => {
  const filter = purgeFilter(req.body);
  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(req.admin.id);
  if (!(await bcrypt.compare(String(req.body?.password ?? ""), admin.password_hash))) {
    throw httpError(400, "管理员密码错误");
  }
  const placeholders = filter.employeeIds.map(() => "?").join(",");
  const parameters = [filter.start, filter.end, ...filter.employeeIds];
  const deleted = {};
  db.transaction(() => {
    if (filter.dataTypes.includes("attendance")) {
      deleted.attendance = db
        .prepare(
          `DELETE FROM attendance
           WHERE attendance_date BETWEEN ? AND ? AND employee_id IN (${placeholders})`
        )
        .run(...parameters).changes;
    }
    if (filter.dataTypes.includes("additionalTasks")) {
      deleted.additionalTasks = db
        .prepare(
          `DELETE FROM additional_tasks
           WHERE task_date BETWEEN ? AND ? AND employee_id IN (${placeholders})`
        )
        .run(...parameters).changes;
    }
    if (filter.dataTypes.includes("dailyOverrides")) {
      deleted.dailyOverrides = db
        .prepare(
          `DELETE FROM daily_task_overrides
           WHERE task_date BETWEEN ? AND ? AND employee_id IN (${placeholders})`
        )
        .run(...parameters).changes;
    }
  })();
  adminLog("purge", "history", null, JSON.stringify({ filter, deleted }));
  res.json({ deleted });
}));

app.get("/api/admin/audit", (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  res.json({
    logs: db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?").all(limit)
  });
});

if (config.serveClient) {
  const clientDist = path.join(config.rootDir, "client", "dist");
  const clientIndex = path.join(clientDist, "index.html");
  if (!fs.existsSync(clientIndex)) {
    throw new Error("未找到前端构建文件，请先运行 npm run build");
  }
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      return res.sendFile(clientIndex);
    }
    next();
  });
}

app.use((req, _res, next) => {
  next(httpError(404, "接口不存在"));
});

app.use((error, _req, res, _next) => {
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ message: "图片不能超过 8MB" });
  }
  const status = Number(error?.status ?? 500);
  if (status >= 500) console.error(error);
  res.status(status).json({
    message: error?.message ?? "服务器错误",
    ...(error?.code ? { code: error.code } : {})
  });
});

app.listen(config.port, config.host, () => {
  if (config.serveClient) {
    console.log(`KUMOHIRO Daka: http://${config.host}:${config.port}/`);
    console.log(`管理后台: http://${config.host}:${config.port}/admin`);
  } else {
    console.log(`KUMOHIRO Daka API: http://${config.host}:${config.port}`);
  }
  if (config.initialAdminPassword === "admin123") {
    console.warn("请登录后台后立即修改默认管理员密码。");
  }
});
