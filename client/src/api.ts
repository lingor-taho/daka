const DEVICE_KEY = "kumohiro_daka_device_code";

export function getDeviceCode() {
  let code = localStorage.getItem(DEVICE_KEY);
  if (!code) {
    code = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, code);
  }
  return code;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  payload?: unknown;

  constructor(message: string, status: number, code?: string, payload?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit & { device?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.device) headers.set("X-Device-Code", getDeviceCode());
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin"
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const record = payload as { message?: string; code?: string } | null;
    throw new ApiError(record?.message ?? "请求失败", response.status, record?.code, payload);
  }
  return payload as T;
}

export function jsonBody(value: unknown) {
  return JSON.stringify(value);
}

