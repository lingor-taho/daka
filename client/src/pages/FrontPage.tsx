import {
  CalendarDays,
  Check,
  Clock3,
  Copy,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, getDeviceCode, jsonBody } from "../api";
import CheckoutOutro from "../components/CheckoutOutro";
import DailyIntro from "../components/DailyIntro";
import GanttBoard from "../components/GanttBoard";
import AttendanceActions from "../components/AttendanceActions";
import Modal from "../components/Modal";
import { formatAppTime, useAppTimeZone, type AppTimeZone } from "../timeZone";
import type { AttendanceSummary, DaySchedule, EmployeeSchedule, Task } from "../types";

interface FrontPayload {
  displayTimeZone: AppTimeZone;
  device: { id: number; label: string; employeeId: number };
  schedule: DaySchedule;
}

function dateLabel(date: string, timeZone: AppTimeZone) {
  const parsed = new Date(`${date}T12:00:00Z`);
  const datePart = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(parsed);
  const weekdayPart = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    weekday: "long"
  }).format(parsed);
  return `${datePart} · ${weekdayPart}`;
}

export default function FrontPage() {
  const { displayTimeZone, setDisplayTimeZone } = useAppTimeZone();
  const [payload, setPayload] = useState<FrontPayload | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedTask, setSelectedTask] = useState<{
    task: Task;
    employee: EmployeeSchedule;
  } | null>(null);
  const [checkoutEmployee, setCheckoutEmployee] = useState<EmployeeSchedule | null>(null);
  const [checkoutNote, setCheckoutNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const attendanceBusy = useRef(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(new Date());

  const deviceCode = useMemo(() => getDeviceCode(), []);
  const currentEmployee = payload?.schedule.employees.find((employee) => employee.isCurrent);

  async function load() {
    setLoading(true);
    setMessage("");
    try {
      const result = await api<FrontPayload>("/api/front/today", { device: true });
      setDisplayTimeZone(result.displayTimeZone);
      setPayload(result);
      setPending(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "DEVICE_PENDING") {
        setPending(true);
        setPayload(null);
      } else {
        setMessage(error instanceof Error ? error.message : "页面暂时无法打开");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function updateAttendance(summary: AttendanceSummary) {
    setPayload(current => !current ? current : {
      ...current, schedule: { ...current.schedule, employees: current.schedule.employees.map(employee =>
        employee.isCurrent ? { ...employee, attendance: summary } : employee) }
    });
  }

  async function pauseToggle() {
    if (attendanceBusy.current || !payload || !currentEmployee) return;
    attendanceBusy.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      const action = currentEmployee.attendance.status === "paused" ? "resume" : "pause";
      const result = await api<{ summary: AttendanceSummary }>(`/api/front/${action}`, {
        method: "POST", device: true,
        body: jsonBody({ date: payload.schedule.date, revision: currentEmployee.attendance.pauseRevision })
      });
      updateAttendance(result.summary);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ATTENDANCE_STATE_CHANGED") {
        updateAttendance((error.payload as { summary: AttendanceSummary }).summary);
      }
      setMessage(error instanceof Error ? error.message : "操作失败，请重试");
    } finally {
      attendanceBusy.current = false;
      setSubmitting(false);
    }
  }

  async function checkout() {
    if (attendanceBusy.current || !payload) return;
    attendanceBusy.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      const result = await api<{
        alreadyCheckedOut: boolean;
        summary: AttendanceSummary;
      }>("/api/front/checkout", {
        method: "POST",
        device: true,
        body: jsonBody({ note: checkoutNote, date: payload.schedule.date })
      });
      updateAttendance(result.summary);
      setCheckoutEmployee(null);
      setCheckoutNote("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "退勤失败");
    } finally {
      attendanceBusy.current = false;
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">K</div>
        <p>正在确认设备与今日安排…</p>
      </main>
    );
  }

  if (pending) {
    return (
      <main className="device-gate">
        <section className="gate-card">
          <div className="brand-lockup">
            <div className="brand-mark">K</div>
            <div>
              <span>KUMOHIRO</span>
              <strong>工作看板</strong>
            </div>
          </div>
          <div className="gate-illustration">
            <ShieldCheck size={42} />
          </div>
          <span className="eyebrow">DEVICE APPROVAL</span>
          <h1>这台设备正在等待授权</h1>
          <p>设备已自动进入管理员的待授权列表。完成员工绑定后，请手动刷新此页面。</p>
          <label className="device-code-box">
            <span>当前浏览器设备码</span>
            <code>{deviceCode}</code>
          </label>
          <div className="gate-actions">
            <button
              className="button secondary"
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(deviceCode);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
              {copied ? "已复制" : "复制设备码"}
            </button>
            <button className="button primary" type="button" onClick={() => void load()}>
              <RefreshCw size={17} /> 手动刷新
            </button>
          </div>
          <small>设备码保存在当前浏览器中，清除浏览器数据后需要重新授权。</small>
        </section>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="device-gate">
        <section className="gate-card">
          <h1>暂时无法打开工作看板</h1>
          <p>{message || "请检查网络后重试。"}</p>
          <button className="button primary" type="button" onClick={() => void load()}>
            <RefreshCw size={17} /> 重新打开
          </button>
        </section>
      </main>
    );
  }

  if (currentEmployee?.attendance.status === "checked_out") {
    return (
      <CheckoutOutro
        employeeName={currentEmployee.name}
        checkoutTime={formatAppTime(currentEmployee.attendance.clockOutAt, displayTimeZone)}
      />
    );
  }

  return (
    <>
      <DailyIntro />
      <main className="front-page">
      <header className="front-header">
        <div className="brand-lockup">
          <div className="brand-mark">K</div>
          <div>
            <span>KUMOHIRO</span>
            <strong>每日工作看板</strong>
          </div>
        </div>
        <div className="header-clock">
          <Clock3 size={17} />
          <strong>
            {new Intl.DateTimeFormat("zh-CN", {
              timeZone: displayTimeZone,
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              hourCycle: "h23"
            }).format(now)}
          </strong>
          <button type="button" className="refresh-button" disabled={submitting} onClick={() => void load()}>
            <RefreshCw size={16} /> 手动刷新
          </button>
        </div>
      </header>

      <section className="front-hero">
        <div>
          <span className="eyebrow">TODAY'S FLOW</span>
          <h1>{dateLabel(payload.schedule.date, displayTimeZone)}</h1>
        </div>
        <div className="hero-status">
          <div className="status-icon">
            <Sparkles size={22} />
          </div>
          <div>
            <span>当前身份</span>
            <strong>{currentEmployee?.name ?? "员工"}</strong>
            <small>{currentEmployee?.position || "未设置岗位"}</small>
          </div>
          <div className="clock-in-chip">
            <span>上班记录</span>
            <strong>{formatAppTime(currentEmployee?.attendance.clockInAt, displayTimeZone)}</strong>
          </div>
        </div>
      </section>

      {payload.schedule.holiday ? (
        <div className="holiday-banner">
          <CalendarDays size={20} />
          <div>
            <strong>{payload.schedule.holiday.name}</strong>
            <span>今天默认任务暂停显示，新增任务和考勤功能仍正常使用。</span>
          </div>
        </div>
      ) : null}

      {message ? <div className="inline-alert">{message}</div> : null}

      <section className="board-section">
        {currentEmployee?.attendance.status === "paused" ? <div className="inline-alert pause-notice" role="status">
          已于 {formatAppTime(currentEmployee.attendance.pausedAt, displayTimeZone)} 暂停计时，回来后请点击“恢复”。暂停期间不计入工作时长。
        </div> : null}
        <div className="section-heading">
          <div>
            <span className="eyebrow">DAILY GANTT</span>
            <h2>今日工作一览</h2>
          </div>
          <div className="legend">
            <span><i className="legend-default" />默认任务</span>
            <span><i className="legend-added" />新增任务</span>
          </div>
        </div>
        <GanttBoard
          schedule={payload.schedule}
          onPauseToggle={() => void pauseToggle()}
          attendanceBusy={submitting}
          onTaskClick={(task, employee) => setSelectedTask({ task, employee })}
          onCheckout={(employee) => {
            setCheckoutEmployee(employee);
            setCheckoutNote("");
          }}
        />
      </section>

      {currentEmployee ? (
        <AttendanceActions mobile paused={currentEmployee.attendance.status === "paused"} busy={submitting}
          onPauseToggle={() => void pauseToggle()}
          onCheckout={() => {
            setCheckoutEmployee(currentEmployee ?? null);
            setCheckoutNote("");
          }}
        />
      ) : null}

      <footer className="front-footer">
        <span>设备：{payload.device.label || deviceCode.slice(0, 8)}</span>
      </footer>

      {selectedTask ? (
        <Modal
          title={selectedTask.task.title}
          onClose={() => setSelectedTask(null)}
          footer={
            <button className="button primary" type="button" onClick={() => setSelectedTask(null)}>
              我知道了
            </button>
          }
        >
          <div className="task-meta">
            <span>{selectedTask.employee.name}</span>
            <span>
              {String(selectedTask.task.startHour).padStart(2, "0")}:00–
              {String(selectedTask.task.endHour).padStart(2, "0")}:00
            </span>
            <span>{selectedTask.task.source === "additional" ? "新增任务" : "默认任务"}</span>
          </div>
          {selectedTask.task.descriptionHtml ? (
            <article
              className="rich-preview"
              dangerouslySetInnerHTML={{ __html: selectedTask.task.descriptionHtml }}
            />
          ) : (
            <p className="empty-detail">此任务暂无详细说明。</p>
          )}
        </Modal>
      ) : null}

      {checkoutEmployee ? (
        <Modal
          title="确认退勤"
          onClose={() => !submitting && setCheckoutEmployee(null)}
          footer={
            <>
              <button
                className="button ghost"
                type="button"
                disabled={submitting}
                onClick={() => setCheckoutEmployee(null)}
              >
                暂不退勤
              </button>
              <button
                className="button danger"
                type="button"
                disabled={submitting}
                onClick={() => void checkout()}
              >
                <LogOut size={17} />
                {submitting ? "正在记录…" : "确认退勤"}
              </button>
            </>
          }
        >
          <div className="checkout-summary">
            <strong>{checkoutEmployee.name}</strong>
            <span>退勤后员工本人不能撤销或修改，如有误操作请联系管理员。</span>
            <span>当日工作时长会自动扣除所有暂停时段；暂停中退勤，不会把暂停后的时间算入工作时长。</span>
          </div>
          {message ? <div className="form-error" role="alert">{message}</div> : null}
          <label className="field">
            <span>当日工作说明（选填）</span>
            <textarea
              rows={5}
              value={checkoutNote}
              maxLength={2000}
              placeholder="可以简单记录今天的完成情况，也可以留空。"
              onChange={(event) => setCheckoutNote(event.target.value)}
            />
            <small>{checkoutNote.length}/2000</small>
          </label>
        </Modal>
      ) : null}
      </main>
    </>
  );
}
