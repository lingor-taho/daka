import { ChevronLeft, ChevronRight, Download, RefreshCw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api, jsonBody } from "../api";
import Modal from "../components/Modal";
import { formatAppTime, todayInTimeZone, useAppTimeZone, type AppTimeZone } from "../timeZone";
import type { AttendanceDay, AttendanceDayStatus, AttendanceMonth, Employee } from "../types";

const statusLabels: Record<AttendanceDayStatus, string> = {
  complete: "正常出勤", working: "工作中", paused: "暂停中", incomplete: "打卡不全", absent: "缺勤",
  rest: "休息日", unscheduled: "无任务", pending: "待打卡", future: "未到日期", untracked: "未加入"
};
const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7);
}

function hoursWorked(day: AttendanceDay) {
  return (day.record?.work_seconds ?? 0) / 3600;
}

function dayLabel(day: AttendanceDay) {
  if (day.status === "incomplete" && day.record?.work_ended_at) return "暂停截止";
  return day.status === "incomplete" && day.record?.clock_in_at ? "缺少退勤" : statusLabels[day.status];
}

export default function AttendanceTab() {
  const { displayTimeZone } = useAppTimeZone();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState(0);
  const [selectedMonth, setMonth] = useState<string | null>(null);
  const month = selectedMonth || todayInTimeZone(displayTimeZone).slice(0, 7);
  const [calendar, setCalendar] = useState<AttendanceMonth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<{ day: AttendanceDay; employee: Employee } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api<{ employees: Employee[] }>("/api/admin/employees", { signal: controller.signal })
      .then(result => {
        setEmployees(result.employees);
        setEmployeeId(current => result.employees.some(e => e.id === current) ? current : result.employees[0]?.id || 0);
        if (!result.employees.length) setLoading(false);
      }).catch(caught => {
        if (!controller.signal.aborted) { setError(caught.message || "员工加载失败"); setLoading(false); }
      });
    return () => controller.abort();
  }, [refresh]);

  useEffect(() => {
    if (!employeeId) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api<AttendanceMonth>(`/api/admin/attendance/calendar?employeeId=${employeeId}${selectedMonth ? `&month=${selectedMonth}` : ""}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setCalendar(result);
        setMonth(result.month);
      }).catch(caught => {
        if (!controller.signal.aborted) setError(caught.message || "考勤加载失败");
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [employeeId, selectedMonth, refresh, displayTimeZone]);

  const data = calendar?.employee?.id === employeeId && calendar.month === month && !loading && !error ? calendar : null;
  const firstMonth = calendar?.employee?.id === employeeId ? calendar.firstMonth : month;
  const currentMonth = calendar?.currentMonth || todayInTimeZone(displayTimeZone).slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const years = Array.from({ length: Math.max(1, Number(currentMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4)) + 1) }, (_, i) => Number(firstMonth.slice(0, 4)) + i);
  const lead = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const days = data?.days || [];
  const trailing = (7 - (lead + days.length) % 7) % 7;
  const summary = {
    complete: days.filter(d => d.status === "complete").length,
    absent: days.filter(d => d.status === "absent").length,
    incomplete: days.filter(d => d.status === "incomplete").length,
    hours: days.reduce((total, d) => total + hoursWorked(d), 0)
  };
  const exportEnd = data ? (data.today < (days.at(-1)?.date || data.today) ? data.today : days.at(-1)!.date) : "";

  return <>
    <header className="admin-section-header">
      <div><span className="eyebrow">ATTENDANCE</span><h1>考勤记录</h1><p>按月查看员工出勤，点击日期可查看和修正当天考勤。</p></div>
      <div className="section-actions">
        {data?.employee ? <a className="button primary" href={`/api/admin/attendance/export.xlsx?start=${month}-01&end=${exportEnd}&employeeId=${employeeId}`}><Download size={16} /> 导出 Excel</a>
          : <button type="button" className="button primary" disabled><Download size={16} /> 导出 Excel</button>}
      </div>
    </header>
    <div className="filter-bar attendance-filters">
      <label><span>年份</span><select aria-label="年份" value={year} disabled={!data} onChange={e => {
        const next = `${e.target.value}-${String(monthNumber).padStart(2, "0")}`;
        setMonth(next < firstMonth ? firstMonth : next > currentMonth ? currentMonth : next);
      }}>{years.map(value => <option key={value} value={value}>{value}年</option>)}</select></label>
      <label><span>月份</span><select aria-label="月份" value={monthNumber} disabled={!data} onChange={e => setMonth(`${year}-${e.target.value.padStart(2, "0")}`)}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map(value => {
          const candidate = `${year}-${String(value).padStart(2, "0")}`;
          return <option key={value} value={value} disabled={candidate < firstMonth || candidate > currentMonth}>{value}月</option>;
        })}
      </select></label>
      <label className="attendance-employee-filter"><span>员工</span><select aria-label="员工" value={employeeId} disabled={!employees.length} onChange={e => { setEmployeeId(Number(e.target.value)); setEditing(null); }}>
        {!employees.length ? <option value={0}>暂无员工</option> : null}
        {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.active ? "" : "（已停用）"}</option>)}
      </select></label>
      <button className="button secondary" type="button" onClick={() => { setLoading(true); setRefresh(n => n + 1); }} disabled={loading}><RefreshCw size={16} /> 刷新</button>
    </div>
    {error ? <div className="form-error" role="alert">{error}</div> : null}
    {data?.employee ? <>
      <div className="metric-strip attendance-metrics">
        <div><span>正常出勤</span><strong>{summary.complete}<small> 天</small></strong></div>
        <div><span>缺勤</span><strong className="attendance-absent-count">{summary.absent}<small> 天</small></strong></div>
        <div><span>打卡不全</span><strong>{summary.incomplete}<small> 天</small></strong></div>
        <div><span>累计时长</span><strong>{summary.hours.toFixed(1)}<small> h</small></strong></div>
      </div>
      <section className="attendance-calendar" aria-label={`${data.employee.name} ${year}年${monthNumber}月考勤`}>
        <div className="attendance-calendar-heading">
          <div className="attendance-month-nav">
            <span className="attendance-nav-slot">{month > firstMonth ? <button className="icon-button" aria-label="上一个月" title="上一个月" type="button" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={19} /></button> : null}</span>
            <h2>{year}年 <span>{monthNumber}月</span></h2>
            <span className="attendance-nav-slot">{month < currentMonth ? <button className="icon-button" aria-label="下一个月" title="下一个月" type="button" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={19} /></button> : null}</span>
          </div>
          <div className="attendance-calendar-person"><strong>{data.employee.name}</strong><span>{data.employee.position}</span></div>
        </div>
        <div className="attendance-calendar-legend" aria-label="日历颜色说明">
          <span><i className="legend-attended" />正常 / 工作中</span><span><i className="legend-absent" />缺勤</span><span><i className="legend-incomplete" />暂停 / 打卡不全</span><span><i className="legend-neutral" />休息 / 无任务</span>
        </div>
        <div className="attendance-weekdays" aria-hidden="true">{weekdays.map(day => <span key={day}>{day}</span>)}</div>
        <div className="attendance-calendar-grid">
          {Array.from({ length: lead }, (_, i) => <div className="attendance-day-padding" key={`lead-${i}`} aria-hidden="true" />)}
          {days.map(day => {
            const label = dayLabel(day);
            const clockIn = formatAppTime(day.record?.clock_in_at, displayTimeZone);
            const clockOut = formatAppTime(day.record?.clock_out_at, displayTimeZone);
            const description = `${day.date} ${label}；上班 ${clockIn}，退勤 ${clockOut}${day.record?.checkout_note ? `；${day.record.checkout_note}` : ""}${day.holiday ? `；${day.holiday}` : ""}`;
            return <button type="button" key={day.date} className={`attendance-day attendance-day-${day.status}${day.date === data.today ? " is-today" : ""}`} disabled={!day.editable}
              aria-label={description} title={description} aria-current={day.date === data.today ? "date" : undefined} onClick={() => setEditing({ day, employee: data.employee! })}>
              <span className="attendance-day-top"><strong>{Number(day.date.slice(-2))}</strong>{day.date === data.today ? <em>今</em> : null}</span>
              <span className="attendance-day-status">{label}</span>
              {day.record?.clock_in_at || day.record?.clock_out_at ? <span className="attendance-day-times"><span><i>上 </i>{clockIn}</span><span><i>{!day.record?.clock_out_at && day.record?.work_ended_at ? "截 " : "下 "}</i>{formatAppTime(day.record?.clock_out_at || day.record?.work_ended_at, displayTimeZone)}</span></span> : null}
              {day.record?.work_seconds != null ? <span className="attendance-day-note">净时长 {hoursWorked(day).toFixed(1)}h</span> : null}
              {day.record?.checkout_note ? <span className="attendance-day-note">有说明</span> : null}
            </button>;
          })}
          {Array.from({ length: trailing }, (_, i) => <div className="attendance-day-padding" key={`tail-${i}`} aria-hidden="true" />)}
        </div>
        <p className="attendance-calendar-help">时长已扣除暂停时段；未退勤时，以最后暂停时间截止，恢复后的时长待退勤后结算。缺勤仅统计已过去、有任务且未打上班卡的日期。点击日期可查看详情或补录。</p>
      </section>
    </> : <div className="empty-panel" role="status">{loading ? "正在加载考勤日历…" : error ? "请刷新重试。" : "暂无员工，请先添加员工。"}</div>}
    {editing ? <AttendanceEditModal key={`${editing.employee.id}-${editing.day.date}`} day={editing.day} employee={editing.employee} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setLoading(true); setRefresh(n => n + 1); }} /> : null}
  </>;
}

function localInput(value: string | null | undefined, timeZone: AppTimeZone) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function AttendanceEditModal({ day, employee, onClose, onSaved }: { day: AttendanceDay; employee: Employee; onClose: () => void; onSaved: () => void }) {
  const { displayTimeZone } = useAppTimeZone();
  const [clockInAt, setClockInAt] = useState(localInput(day.record?.clock_in_at, displayTimeZone));
  const [clockOutAt, setClockOutAt] = useState(localInput(day.record?.clock_out_at, displayTimeZone));
  const [checkoutNote, setCheckoutNote] = useState(day.record?.checkout_note || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    try {
      await api(day.record ? `/api/admin/attendance/${day.record.id}` : "/api/admin/attendance", {
        method: day.record ? "PUT" : "POST", body: jsonBody({ clockInAt, clockOutAt, checkoutNote, reason, employeeId: employee.id, date: day.date })
      });
      onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，请重试"); }
    finally { setSaving(false); }
  }
  return <Modal title={`${day.record ? "修正" : "补录"}考勤 · ${employee.name}`} onClose={() => { if (!saving) onClose(); }} footer={<>
    <button className="button ghost" type="button" disabled={saving} onClick={onClose}>取消</button>
    <button className="button primary" type="button" disabled={saving || !reason.trim()} onClick={() => void save()}><Save size={16} />{saving ? "保存中…" : "保存修正"}</button>
  </>}>
    <div className="info-note">{day.date} · {displayTimeZone === "Asia/Tokyo" ? "日本时间" : "中国时间"} · 所有修正都会保留修改前后记录。</div>
    {error ? <div className="form-error" role="alert">{error}</div> : null}
    {day.record?.pauses.length ? <div className="attendance-pause-details">
      <strong>暂停 / 恢复记录</strong>
      {day.record.pauses.map(pause => <p key={pause.id}>
        {formatAppTime(pause.paused_at, displayTimeZone)} → {pause.resumed_at ? formatAppTime(pause.resumed_at, displayTimeZone) : "未恢复"}
      </p>)}
      <p>净工作时长：{day.record.work_seconds == null ? "尚未截止" : `${hoursWorked(day).toFixed(2)} 小时`}。修改上下班时间不会删除暂停记录，仅扣除上下班区间内的暂停时间。</p>
      {!day.record.clock_out_at && day.record.work_ended_at ? <p>尚未退勤，暂计至最后一次暂停 {formatAppTime(day.record.work_ended_at, displayTimeZone)}；恢复后的工作时间在退勤后计入。</p> : null}
    </div> : null}
    <label className="field"><span>上班时间</span><input type="datetime-local" min={`${day.date}T00:00`} max={`${day.date}T23:59`} value={clockInAt} onChange={e => setClockInAt(e.target.value)} /></label>
    <label className="field"><span>退勤时间</span><input type="datetime-local" min={`${day.date}T00:00`} max={`${day.date}T23:59`} value={clockOutAt} onChange={e => setClockOutAt(e.target.value)} /></label>
    <label className="field"><span>退勤说明</span><textarea rows={3} maxLength={2000} value={checkoutNote} onChange={e => setCheckoutNote(e.target.value)} /></label>
    <label className="field"><span>修正原因（必填）</span><textarea rows={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
  </Modal>;
}
