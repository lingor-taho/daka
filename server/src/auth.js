import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { db } from "./db.js";
import { appDateTime, hashToken, httpError } from "./utils.js";

const ADMIN_COOKIE = "daka_admin_session";
const DEVICE_COOKIE = "daka_device_session";

export function createAdminSession(res, adminId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 8 * 60 * 60 * 1000);
  db.prepare(
    `INSERT INTO admin_sessions (admin_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(adminId, hashToken(token), expires.toISOString(), appDateTime());
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/"
  });
}

export function clearAdminSession(req, res) {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(token));
  res.clearCookie(ADMIN_COOKIE, { path: "/" });
}

export function getAdmin(req) {
  const token = req.cookies?.[ADMIN_COOKIE];
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT admins.id, admins.username, admins.must_change_password, admin_sessions.expires_at
       FROM admin_sessions
       JOIN admins ON admins.id = admin_sessions.admin_id
       WHERE admin_sessions.token_hash = ?`
    )
    .get(hashToken(token));
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) {
    if (row) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(token));
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    mustChangePassword: Boolean(row.must_change_password)
  };
}

export function requireAdmin(req, _res, next) {
  const admin = getAdmin(req);
  if (!admin) return next(httpError(401, "请先登录管理员后台", "ADMIN_LOGIN_REQUIRED"));
  req.admin = admin;
  next();
}

export function issueDeviceCookie(res, device) {
  const token = jwt.sign(
    { deviceId: device.id, deviceCode: device.device_code },
    config.sessionSecret,
    { expiresIn: "400d", issuer: "kumohiro-daka" }
  );
  res.cookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: "lax",
    maxAge: 400 * 24 * 60 * 60 * 1000,
    path: "/"
  });
}

export function getAuthorizedDevice(req) {
  let deviceCode = String(req.get("x-device-code") ?? "").trim();
  if (!deviceCode) {
    const token = req.cookies?.[DEVICE_COOKIE];
    if (token) {
      try {
        const payload = jwt.verify(token, config.sessionSecret, {
          issuer: "kumohiro-daka"
        });
        deviceCode = String(payload.deviceCode ?? "");
      } catch {
        return null;
      }
    }
  }
  if (!deviceCode) return null;
  const row = db
    .prepare(
      `SELECT devices.*, employees.name AS employee_name, employees.position, employees.active
       FROM devices
       LEFT JOIN employees ON employees.id = devices.employee_id
       WHERE devices.device_code = ?`
    )
    .get(deviceCode);
  if (!row || !row.enabled || !row.employee_id || !row.active) return null;
  return row;
}

export function requireDevice(req, res, next) {
  const device = getAuthorizedDevice(req);
  if (!device) return next(httpError(403, "当前设备尚未授权", "DEVICE_NOT_AUTHORIZED"));
  req.device = device;
  issueDeviceCookie(res, device);
  next();
}

export function canReadMedia(req) {
  return Boolean(getAdmin(req) || getAuthorizedDevice(req));
}
