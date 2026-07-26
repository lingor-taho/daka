import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { api } from "./api";

export type AppTimeZone = "Asia/Shanghai" | "Asia/Tokyo";

interface TimeZoneContextValue {
  displayTimeZone: AppTimeZone;
  setDisplayTimeZone: (value: AppTimeZone) => void;
}

const TimeZoneContext = createContext<TimeZoneContextValue | null>(null);

export function AppTimeZoneProvider({ children }: { children: ReactNode }) {
  const [displayTimeZone, setDisplayTimeZone] = useState<AppTimeZone>("Asia/Tokyo");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void api<{ displayTimeZone: AppTimeZone }>("/api/app-config")
      .then((result) => setDisplayTimeZone(result.displayTimeZone))
      .catch(() => {
        // API 暂不可用时使用默认日本时区，具体错误由页面数据请求显示。
      })
      .finally(() => setReady(true));
  }, []);

  const value = useMemo(
    () => ({ displayTimeZone, setDisplayTimeZone }),
    [displayTimeZone]
  );

  if (!ready) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">K</div>
        <p>正在同步系统时间…</p>
      </main>
    );
  }

  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>;
}

export function useAppTimeZone() {
  const context = useContext(TimeZoneContext);
  if (!context) throw new Error("TimeZoneContext is not available");
  return context;
}

export function todayInTimeZone(timeZone: AppTimeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(date)
    .filter((part) => part.type !== "literal");
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

export function formatAppTime(
  value: string | null | undefined,
  timeZone: AppTimeZone,
  includeDate = false
) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    ...(includeDate ? { year: "numeric", month: "2-digit", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).format(date);
}
