import crypto from "node:crypto";
import sanitizeHtml from "sanitize-html";

const chinaDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23"
});

export function chinaNowParts(date = new Date()) {
  return Object.fromEntries(
    chinaDateTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
}

export function chinaDate(date = new Date()) {
  const parts = chinaNowParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chinaDateTime(date = new Date()) {
  const parts = chinaNowParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) {
    throw httpError(400, "日期格式无效");
  }
  const candidate = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(candidate.getTime())) throw httpError(400, "日期无效");
  return String(value);
}

export function weekdayForDate(value) {
  return new Date(`${value}T12:00:00+08:00`).getUTCDay();
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
