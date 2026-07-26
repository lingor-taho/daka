import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";

export const TIME_ZONE_OPTIONS = {
  "Asia/Shanghai": { label: "中国时间", offsetMinutes: 8 * 60 },
  "Asia/Tokyo": { label: "日本时间", offsetMinutes: 9 * 60 }
};

let currentServerTimeZone = "Asia/Shanghai";
let currentDisplayTimeZone = "Asia/Tokyo";

export function validateTimeZone(value, fieldName = "时区") {
  const timeZone = String(value ?? "");
  if (!Object.hasOwn(TIME_ZONE_OPTIONS, timeZone)) {
    throw httpError(400, `${fieldName}无效`);
  }
  return timeZone;
}

export function setTimeZoneConfig(serverTimeZone, displayTimeZone) {
  currentServerTimeZone = validateTimeZone(serverTimeZone, "服务器时区");
  currentDisplayTimeZone = validateTimeZone(displayTimeZone, "程序显示时区");
}

export function getServerTimeZone() {
  return currentServerTimeZone;
}

export function getDisplayTimeZone() {
  return currentDisplayTimeZone;
}

export function appNowParts(date = new Date(), timeZone = currentDisplayTimeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: validateTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export function appDate(date = new Date(), timeZone = currentDisplayTimeZone) {
  const parts = appNowParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function appDateTime(date = new Date()) {
  return date.toISOString();
}

export function formatAppDateTime(value, timeZone = currentDisplayTimeZone) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = appNowParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function zonedLocalDateTimeToIso(value, timeZone = currentDisplayTimeZone) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw httpError(400, "日期时间格式无效");
  const [, year, month, day, hour, minute] = match;
  const offsetMinutes = TIME_ZONE_OPTIONS[validateTimeZone(timeZone)].offsetMinutes;
  const timestamp =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)) -
    offsetMinutes * 60_000;
  const result = new Date(timestamp);
  const check = appNowParts(result, timeZone);
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    throw httpError(400, "日期时间无效");
  }
  return result.toISOString();
}

export function parseDate(value) {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw httpError(400, "日期格式无效");
  }
  const [, year, month, day] = match;
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    candidate.getUTCFullYear() !== Number(year) ||
    candidate.getUTCMonth() + 1 !== Number(month) ||
    candidate.getUTCDate() !== Number(day)
  ) {
    throw httpError(400, "日期无效");
  }
  return text;
}

export function weekdayForDate(value) {
  const [year, month, day] = parseDate(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function randomId() {
  return crypto.randomUUID();
}

export function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function safeText(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function validateHour(value, fieldName = "时间") {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 24) {
    throw httpError(400, `${fieldName}必须为整点`);
  }
  return parsed;
}

export function validateTimeRange(start, end) {
  const startHour = validateHour(start, "开始时间");
  const endHour = validateHour(end, "结束时间");
  if (startHour >= endHour) throw httpError(400, "结束时间必须晚于开始时间");
  return { startHour, endHour };
}

export function validateWeekdays(value) {
  if (!Array.isArray(value)) throw httpError(400, "适用星期格式无效");
  const days = [...new Set(value.map(Number))].sort();
  if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw httpError(400, "至少选择一个有效星期");
  }
  return days;
}

export function cleanRichText(value) {
  return sanitizeHtml(String(value ?? ""), {
    allowedTags: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "h2",
      "h3",
      "span",
      "a",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "img"
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      span: ["style"],
      p: ["style"],
      table: ["style"],
      th: ["colspan", "rowspan", "style"],
      td: ["colspan", "rowspan", "style"],
      img: ["src", "alt", "title"]
    },
    allowedStyles: {
      "*": {
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/],
        "font-size": [/^\d+(?:px|rem|em|%)$/],
        "text-align": [/^(left|center|right)$/],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb\(/]
      },
      table: {
        width: [/^\d+(?:px|%)$/],
        "border-collapse": [/^collapse$/]
      },
      td: {
        border: [/^[\w\s#().,-]+$/],
        padding: [/^\d+(?:px|rem|em)$/]
      },
      th: {
        border: [/^[\w\s#().,-]+$/],
        padding: [/^\d+(?:px|rem|em)$/]
      }
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https"]
    },
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" }
      })
    }
  });
}

export function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function asBoolean(value) {
  return value === true || value === 1 || value === "1";
}
