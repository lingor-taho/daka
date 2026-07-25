import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Database,
  Download,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, formatChinaTime, getDeviceCode, jsonBody, todayInChina } from "../api";
import GanttBoard from "../components/GanttBoard";
import Modal from "../components/Modal";
import RichTextEditor from "../components/RichTextEditor";
import type {
  AttendanceRecord,
  DaySchedule,
  Device,
  Employee,
  EmployeeSchedule,
  Task,
  TemplateTask
} from "../types";

type AdminTab = "schedule" | "employees" | "devices" | "attendance" | "settings";

interface AdminUser {
  id: number;
  username: string;
  mustChangePassword: boolean;
}

function AdminLogin({ onLogin }: { onLogin: (admin: AdminUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const result = await api<{ admin: AdminUser }>("/api/admin/login", {
        method: "POST",
        body: jsonBody({ username, password })
      });
      onLogin(result.admin);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-login-page">
      <section className="admin-login-visual">
        <div className="brand-lockup light">
          <div className="brand-mark">K</div>
          <div>
            <span>KUMOHIRO</span>
            <strong>DAKA MANAGEMENT</strong>
          </div>
        </div>
        <div className="login-visual-copy">
          <span className="eyebrow">WORKFLOW CONTROL</span>
          <h1>让每一天的工作安排，清晰可见。</h1>
          <p>统一管理员工任务、设备授权与考勤记录。</p>
        </div>
        <div className="login-orbit"><span /><span /><span /></div>
      </section>
      <section className="admin-login-panel">
        <form className="login-form" onSubmit={submit}>
          <div className="login-badge"><ShieldCheck size={24} /></div>
          <span className="eyebrow">ADMIN ACCESS</span>
          <h2>管理员登录</h2>
          <p>后台不受设备白名单限制。</p>
          {error ? <div className="form-error">{error}</div> : null}
          <label className="field">
            <span>用户名</span>
            <input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              placeholder="请输入管理员密码"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button primary login-submit" disabled={submitting} type="submit">
            {submitting ? "正在登录…" : "进入管理后台"}
          </button>
          <small>首次使用默认账号 admin / admin123，登录后请立即修改密码。</small>
        </form>
      </section>
    </main>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
  actions
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-section-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </header>
  );
}

const hours = Array.from({ length: 25 }, (_, index) => index);
const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function TaskForm({
  title,
  initial,
  employees,
  defaultOnly,
  onClose,
  onSave,
  onDelete
}: {
  title: string;
  initial?: Partial<Task> & { employeeId?: number };
  employees: Employee[];
  defaultOnly?: boolean;
  onClose: () => void;
  onSave: (value: {
    employeeId: number;
    title: string;
    descriptionHtml: string;
    startHour: number;
    endHour: number;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [employeeId, setEmployeeId] = useState(initial?.employeeId ?? employees[0]?.id ?? 0);
  const [taskTitle, setTaskTitle] = useState(initial?.title ?? "");
  const [descriptionHtml, setDescriptionHtml] = useState(initial?.descriptionHtml ?? "");
  const [startHour, setStartHour] = useState(initial?.startHour ?? 9);
  const [endHour, setEndHour] = useState(initial?.endHour ?? 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal
      title={title}
      wide
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button
              className="button danger-outline"
              type="button"
              disabled={saving}
              onClick={async () => {
                if (!window.confirm("确认删除这条新增任务吗？删除后不能恢复。")) return;
                setSaving(true);
                await onDelete();
              }}
            >
              <Trash2 size={16} /> 删除
            </button>
          ) : null}
          <span className="footer-spacer" />
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button
            className="button primary"
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await onSave({ employeeId, title: taskTitle, descriptionHtml, startHour, endHour });
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "保存失败");
                setSaving(false);
              }
            }}
          >
            <Save size={16} /> {saving ? "保存中…" : "保存任务"}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid">
        <label className="field">
          <span>所属员工</span>
          <select
            disabled={defaultOnly}
            value={employeeId}
            onChange={(event) => setEmployeeId(Number(event.target.value))}
          >
            {employees.filter((employee) => employee.active).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name} · {employee.position || "未设置岗位"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>任务标题</span>
          <input
            value={taskTitle}
            maxLength={120}
            placeholder="例如：商品打包"
            onChange={(event) => setTaskTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span>开始时间</span>
          <select
            disabled={defaultOnly}
            value={startHour}
            onChange={(event) => setStartHour(Number(event.target.value))}
          >
            {hours.slice(0, -1).map((hour) => (
              <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>结束时间</span>
          <select
            disabled={defaultOnly}
            value={endHour}
            onChange={(event) => setEndHour(Number(event.target.value))}
          >
            {hours.slice(1).map((hour) => (
              <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
            ))}
          </select>
        </label>
      </div>
      {defaultOnly ? (
        <div className="info-note">当天默认任务只能替换标题和详细说明，原时间段保持不变。</div>
      ) : null}
      <label className="field">
        <span>详细说明（选填）</span>
        <RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} />
      </label>
    </Modal>
  );
}

function ScheduleTab() {
  const [date, setDate] = useState(todayInChina());
  const [schedule, setSchedule] = useState<DaySchedule | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [editing, setEditing] = useState<{ task?: Task; employee: EmployeeSchedule } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [scheduleResult, employeeResult] = await Promise.all([
        api<{ schedule: DaySchedule }>(`/api/admin/schedule?date=${date}`),
        api<{ employees: Employee[] }>("/api/admin/employees")
      ]);
      setSchedule(scheduleResult.schedule);
      setEmployees(employeeResult.employees);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取任务失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [date]);

  return (
    <>
      <SectionHeader
        eyebrow="DAILY PLANNING"
        title="每日任务安排"
        description="选择任意日期，查看默认任务并为具体员工添加或调整当天工作。"
        actions={
          <>
            <label className="compact-date">
              <CalendarDays size={17} />
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <button className="button secondary" type="button" onClick={() => void load()}>
              <RefreshCw size={16} /> 刷新
            </button>
            {schedule ? (
              <button
                className={`button ${schedule.holiday ? "secondary" : "warm"}`}
                type="button"
                onClick={async () => {
                  if (schedule.holiday) {
                    await api(`/api/admin/holidays/${date}`, { method: "DELETE" });
                  } else {
                    const name = window.prompt("休息日名称", "全员休息日");
                    if (name == null) return;
                    await api("/api/admin/holidays", {
                      method: "POST",
                      body: jsonBody({ date, name })
                    });
                  }
                  await load();
                }}
              >
                <CalendarDays size={16} />
                {schedule.holiday ? "取消休息日" : "设为休息日"}
              </button>
            ) : null}
          </>
        }
      />
      {error ? <div className="form-error">{error}</div> : null}
      {schedule?.holiday ? (
        <div className="holiday-banner admin-holiday">
          <CalendarDays size={20} />
          <div><strong>{schedule.holiday.name}</strong><span>默认任务已隐藏，新增任务保留。</span></div>
        </div>
      ) : null}
      <div className="admin-card">
        {loading || !schedule ? (
          <div className="panel-loading">正在读取 {date} 的安排…</div>
        ) : (
          <GanttBoard
            admin
            schedule={schedule}
            onTaskClick={(task, employee) => setEditing({ task, employee })}
            onAddTask={(employee) => setEditing({ employee })}
          />
        )}
      </div>
      {editing ? (
        <TaskForm
          title={
            editing.task
              ? editing.task.source === "additional"
                ? "编辑新增任务"
                : "替换当天默认任务"
              : "新增当天任务"
          }
          initial={
            editing.task
              ? { ...editing.task, employeeId: editing.employee.id }
              : { employeeId: editing.employee.id, startHour: 9, endHour: 10 }
          }
          employees={employees}
          defaultOnly={Boolean(editing.task && editing.task.source !== "additional")}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            if (editing.task?.source === "additional") {
              await api(`/api/admin/tasks/${editing.task.additionalTaskId}`, {
                method: "PUT",
                body: jsonBody(value)
              });
            } else if (editing.task) {
              await api(`/api/admin/schedule/${date}/default/${editing.task.taskKey}`, {
                method: "PUT",
                body: jsonBody(value)
              });
            } else {
              await api(`/api/admin/schedule/${date}/tasks`, {
                method: "POST",
                body: jsonBody(value)
              });
            }
            setEditing(null);
            await load();
          }}
          onDelete={
            editing.task?.source === "additional"
              ? async () => {
                  await api(`/api/admin/tasks/${editing.task?.additionalTaskId}`, {
                    method: "DELETE"
                  });
                  setEditing(null);
                  await load();
                }
              : undefined
          }
        />
      ) : null}
    </>
  );
}

interface TemplateFormValue {
  title: string;
  descriptionHtml: string;
  startHour: number;
  endHour: number;
  weekdays: number[];
  effectiveFrom: string;
}

function TemplateForm({
  initial,
  onClose,
  onSave,
  onDelete
}: {
  initial?: Partial<TemplateTask>;
  onClose: () => void;
  onSave: (value: TemplateFormValue) => Promise<void>;
  onDelete?: (effectiveFrom: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [descriptionHtml, setDescriptionHtml] = useState(initial?.descriptionHtml ?? "");
  const [startHour, setStartHour] = useState(initial?.startHour ?? 9);
  const [endHour, setEndHour] = useState(initial?.endHour ?? 10);
  const [weekdays, setWeekdays] = useState(initial?.weekdays ?? [1, 2, 3, 4, 5]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayInChina());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  return (
    <Modal
      wide
      title={initial ? "修改默认任务" : "新增默认任务"}
      onClose={onClose}
      footer={
        <>
          {onDelete ? (
            <button
              type="button"
              className="button danger-outline"
              onClick={async () => {
                if (!window.confirm(`确认从 ${effectiveFrom} 起停用这条默认任务吗？`)) return;
                setSaving(true);
                await onDelete(effectiveFrom);
              }}
            >
              <Trash2 size={16} /> 从生效日起停用
            </button>
          ) : null}
          <span className="footer-spacer" />
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button
            className="button primary"
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await onSave({ title, descriptionHtml, startHour, endHour, weekdays, effectiveFrom });
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "保存失败");
                setSaving(false);
              }
            }}
          >
            <Save size={16} /> {saving ? "保存中…" : "保存默认任务"}
          </button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid">
        <label className="field">
          <span>任务标题</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>生效日期</span>
          <div className="date-with-shortcut">
            <input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
            <button type="button" onClick={() => setEffectiveFrom(todayInChina())}>今天</button>
            <button
              type="button"
              onClick={() => {
                const tomorrow = new Date(`${todayInChina()}T12:00:00+08:00`);
                tomorrow.setDate(tomorrow.getDate() + 1);
                setEffectiveFrom(new Intl.DateTimeFormat("en-CA").format(tomorrow));
              }}
            >
              明天
            </button>
          </div>
        </label>
        <label className="field">
          <span>开始时间</span>
          <select value={startHour} onChange={(event) => setStartHour(Number(event.target.value))}>
            {hours.slice(0, -1).map((hour) => <option key={hour} value={hour}>{hour}:00</option>)}
          </select>
        </label>
        <label className="field">
          <span>结束时间</span>
          <select value={endHour} onChange={(event) => setEndHour(Number(event.target.value))}>
            {hours.slice(1).map((hour) => <option key={hour} value={hour}>{hour}:00</option>)}
          </select>
        </label>
      </div>
      <fieldset className="weekday-fieldset">
        <legend>适用星期</legend>
        <div className="weekday-options">
          {weekdayLabels.map((label, day) => (
            <label key={day} className={weekdays.includes(day) ? "selected" : ""}>
              <input
                type="checkbox"
                checked={weekdays.includes(day)}
                onChange={() =>
                  setWeekdays((current) =>
                    current.includes(day) ? current.filter((value) => value !== day) : [...current, day]
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>详细说明（选填）</span>
        <RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} />
      </label>
    </Modal>
  );
}

function EmployeesTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [templates, setTemplates] = useState<TemplateTask[]>([]);
  const [employeeForm, setEmployeeForm] = useState<Employee | "new" | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateTask | "new" | null>(null);
  const [error, setError] = useState("");

  async function loadEmployees() {
    try {
      const result = await api<{ employees: Employee[] }>("/api/admin/employees");
      setEmployees(result.employees);
      setSelectedId((current) => current ?? result.employees[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取员工失败");
    }
  }

  async function loadTemplates(employeeId: number) {
    const result = await api<{ templates: TemplateTask[] }>(
      `/api/admin/employees/${employeeId}/templates`
    );
    setTemplates(result.templates.filter((template) => template.active));
  }

  useEffect(() => {
    void loadEmployees();
  }, []);

  useEffect(() => {
    if (selectedId) void loadTemplates(selectedId);
    else setTemplates([]);
  }, [selectedId]);

  const selected = employees.find((employee) => employee.id === selectedId);

  return (
    <>
      <SectionHeader
        eyebrow="PEOPLE & TEMPLATES"
        title="员工与默认任务"
        description="维护员工档案、显示顺序，以及带生效日期的长期默认工作模板。"
        actions={
          <button className="button primary" type="button" onClick={() => setEmployeeForm("new")}>
            <Plus size={16} /> 新增员工
          </button>
        }
      />
      {error ? <div className="form-error">{error}</div> : null}
      <div className="employee-admin-grid">
        <aside className="employee-list-card">
          <div className="list-card-head"><strong>员工列表</strong><span>{employees.length} 人</span></div>
          <div className="employee-list">
            {employees.map((employee, index) => (
              <div
                key={employee.id}
                className={`employee-item ${selectedId === employee.id ? "selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(employee.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedId(employee.id);
                }}
              >
                <span className="person-avatar">{employee.name.slice(0, 1)}</span>
                <span className="employee-item-copy">
                  <strong>{employee.name}</strong>
                  <small>{employee.position || "未设置岗位"} · {employee.device_count ?? 0} 台设备</small>
                </span>
                <i className={employee.active ? "active" : "inactive"}>
                  {employee.active ? "在职" : "停用"}
                </i>
                <span className="order-buttons">
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label="上移"
                    onClick={async (event) => {
                      event.stopPropagation();
                      const ids = employees.map((item) => item.id);
                      [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                      await api("/api/admin/employees/reorder", {
                        method: "POST",
                        body: jsonBody({ ids })
                      });
                      await loadEmployees();
                    }}
                  ><ArrowUp size={13} /></button>
                  <button
                    type="button"
                    disabled={index === employees.length - 1}
                    aria-label="下移"
                    onClick={async (event) => {
                      event.stopPropagation();
                      const ids = employees.map((item) => item.id);
                      [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]];
                      await api("/api/admin/employees/reorder", {
                        method: "POST",
                        body: jsonBody({ ids })
                      });
                      await loadEmployees();
                    }}
                  ><ArrowDown size={13} /></button>
                </span>
              </div>
            ))}
          </div>
        </aside>
        <section className="templates-card">
          {selected ? (
            <>
              <header className="template-employee-head">
                <div>
                  <span className="eyebrow">SELECTED EMPLOYEE</span>
                  <h2>{selected.name}</h2>
                  <p>{selected.position || "未设置岗位"}</p>
                </div>
                <div>
                  <button className="button secondary" type="button" onClick={() => setEmployeeForm(selected)}>
                    <Pencil size={15} /> 编辑员工
                  </button>
                  <button className="button primary" type="button" onClick={() => setTemplateForm("new")}>
                    <Plus size={15} /> 默认任务
                  </button>
                </div>
              </header>
              <div className="template-list">
                {templates.length ? templates.map((template) => (
                  <button type="button" key={template.taskKey} onClick={() => setTemplateForm(template)}>
                    <div className="template-time">
                      <strong>{String(template.startHour).padStart(2, "0")}:00</strong>
                      <span>至 {String(template.endHour).padStart(2, "0")}:00</span>
                    </div>
                    <div className="template-copy">
                      <strong>{template.title}</strong>
                      <span>{template.weekdays.map((day) => weekdayLabels[day]).join("、")}</span>
                    </div>
                    <small>{template.effectiveFrom} 起生效</small>
                    <Pencil size={16} />
                  </button>
                )) : (
                  <div className="empty-panel">尚未设置默认任务。点击“默认任务”开始添加。</div>
                )}
              </div>
            </>
          ) : <div className="empty-panel">请先新增或选择员工。</div>}
        </section>
      </div>

      {employeeForm ? (
        <EmployeeForm
          employee={employeeForm === "new" ? undefined : employeeForm}
          onClose={() => setEmployeeForm(null)}
          onSave={async (value) => {
            if (employeeForm === "new") {
              await api("/api/admin/employees", { method: "POST", body: jsonBody(value) });
            } else {
              await api(`/api/admin/employees/${employeeForm.id}`, {
                method: "PUT",
                body: jsonBody(value)
              });
            }
            setEmployeeForm(null);
            await loadEmployees();
          }}
        />
      ) : null}

      {templateForm && selected ? (
        <TemplateForm
          initial={templateForm === "new" ? undefined : templateForm}
          onClose={() => setTemplateForm(null)}
          onSave={async (value) => {
            if (templateForm === "new") {
              await api(`/api/admin/employees/${selected.id}/templates`, {
                method: "POST",
                body: jsonBody(value)
              });
            } else {
              await api(`/api/admin/templates/${templateForm.taskKey}`, {
                method: "PUT",
                body: jsonBody(value)
              });
            }
            setTemplateForm(null);
            await loadTemplates(selected.id);
          }}
          onDelete={
            templateForm === "new"
              ? undefined
              : async (effectiveFrom) => {
                  await api(
                    `/api/admin/templates/${templateForm.taskKey}?effectiveFrom=${effectiveFrom}`,
                    { method: "DELETE" }
                  );
                  setTemplateForm(null);
                  await loadTemplates(selected.id);
                }
          }
        />
      ) : null}
    </>
  );
}

function EmployeeForm({
  employee,
  onClose,
  onSave
}: {
  employee?: Employee;
  onClose: () => void;
  onSave: (value: { name: string; position: string; active: boolean }) => Promise<void>;
}) {
  const [name, setName] = useState(employee?.name ?? "");
  const [position, setPosition] = useState(employee?.position ?? "");
  const [active, setActive] = useState(employee?.active ?? true);
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      title={employee ? "编辑员工" : "新增员工"}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button
            className="button primary"
            type="button"
            disabled={saving || !name.trim()}
            onClick={async () => {
              setSaving(true);
              await onSave({ name, position, active });
            }}
          >
            <Save size={16} /> {saving ? "保存中…" : "保存员工"}
          </button>
        </>
      }
    >
      <label className="field"><span>姓名</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>岗位</span><input value={position} onChange={(e) => setPosition(e.target.value)} /></label>
      {employee ? (
        <label className="toggle-field">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span><strong>在职状态</strong><small>停用后不再显示于前台，也不能打卡。</small></span>
        </label>
      ) : null}
    </Modal>
  );
}

function DevicesTab() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [binding, setBinding] = useState<Device | null>(null);
  const [employeeId, setEmployeeId] = useState(0);
  const [label, setLabel] = useState("");

  async function load() {
    await api("/api/admin/devices/register-current", {
      method: "POST",
      body: jsonBody({ deviceCode: getDeviceCode() })
    });
    const [deviceResult, employeeResult] = await Promise.all([
      api<{ devices: Device[] }>("/api/admin/devices"),
      api<{ employees: Employee[] }>("/api/admin/employees")
    ]);
    setDevices(deviceResult.devices);
    setEmployees(employeeResult.employees);
  }

  useEffect(() => { void load(); }, []);
  const pendingCount = devices.filter((device) => !device.enabled || !device.employee_id).length;

  return (
    <>
      <SectionHeader
        eyebrow="DEVICE ACCESS"
        title="设备授权与员工绑定"
        description="员工首次打开前台后，浏览器设备会自动出现在待授权列表。"
        actions={<span className="count-badge">{pendingCount} 台待授权</span>}
      />
      <div className="device-grid">
        {devices.map((device) => {
          const pending = !device.enabled || !device.employee_id;
          return (
            <article className={`device-card ${pending ? "pending" : ""}`} key={device.id}>
              <div className="device-icon"><MonitorSmartphone size={22} /></div>
              <div className="device-copy">
                <span className="device-state">{pending ? "等待授权" : "已授权"}</span>
                <h3>{device.label || "未命名设备"}</h3>
                <p>{device.employee_name ? `${device.employee_name} · ${device.position || "未设置岗位"}` : "尚未绑定员工"}</p>
                <code>{device.device_code}</code>
                <small>最后访问：{formatChinaTime(device.last_seen_at, true)}</small>
              </div>
              <div className="device-actions">
                {pending ? (
                  <button
                    className="button primary small"
                    type="button"
                    onClick={() => {
                      setBinding(device);
                      setEmployeeId(employees.find((item) => item.active)?.id ?? 0);
                      setLabel(device.label);
                    }}
                  >
                    <ShieldCheck size={15} /> 绑定员工
                  </button>
                ) : (
                  <button
                    className="button secondary small"
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("确认解除这台设备的员工绑定吗？")) return;
                      await api(`/api/admin/devices/${device.id}/unbind`, { method: "POST" });
                      await load();
                    }}
                  >
                    解除绑定
                  </button>
                )}
                <button
                  className="icon-button danger-icon"
                  type="button"
                  aria-label="删除设备"
                  onClick={async () => {
                    if (!window.confirm("确认删除这条设备记录吗？")) return;
                    await api(`/api/admin/devices/${device.id}`, { method: "DELETE" });
                    await load();
                  }}
                ><Trash2 size={16} /></button>
              </div>
            </article>
          );
        })}
        {!devices.length ? <div className="empty-panel">还没有设备访问前台。</div> : null}
      </div>
      {binding ? (
        <Modal
          title="绑定设备"
          onClose={() => setBinding(null)}
          footer={
            <>
              <button className="button ghost" type="button" onClick={() => setBinding(null)}>取消</button>
              <button
                className="button primary"
                type="button"
                disabled={!employeeId}
                onClick={async () => {
                  await api(`/api/admin/devices/${binding.id}/bind`, {
                    method: "POST",
                    body: jsonBody({ employeeId, label })
                  });
                  setBinding(null);
                  await load();
                }}
              ><ShieldCheck size={16} /> 确认绑定</button>
            </>
          }
        >
          <label className="field">
            <span>绑定员工</span>
            <select value={employeeId} onChange={(event) => setEmployeeId(Number(event.target.value))}>
              {employees.filter((employee) => employee.active).map((employee) => (
                <option value={employee.id} key={employee.id}>{employee.name} · {employee.position}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>设备备注</span>
            <input value={label} placeholder="例如：张三台式机" onChange={(event) => setLabel(event.target.value)} />
          </label>
          <div className="device-code-box compact"><span>设备码</span><code>{binding.device_code}</code></div>
        </Modal>
      ) : null}
    </>
  );
}

function AttendanceTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [start, setStart] = useState(`${todayInChina().slice(0, 7)}-01`);
  const [end, setEnd] = useState(todayInChina());
  const [employeeId, setEmployeeId] = useState(0);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);

  async function load() {
    const [recordResult, employeeResult] = await Promise.all([
      api<{ attendance: AttendanceRecord[] }>(
        `/api/admin/attendance?start=${start}&end=${end}&employeeId=${employeeId}`
      ),
      api<{ employees: Employee[] }>("/api/admin/employees")
    ]);
    setRecords(recordResult.attendance);
    setEmployees(employeeResult.employees);
  }

  useEffect(() => { void load(); }, []);

  const summary = useMemo(() => ({
    complete: records.filter((record) => record.clock_in_at && record.clock_out_at).length,
    missing: records.filter((record) => record.clock_in_at && !record.clock_out_at).length,
    totalHours: records.reduce((sum, record) => {
      if (!record.clock_in_at || !record.clock_out_at) return sum;
      return sum + Math.max(0, (new Date(record.clock_out_at).getTime() - new Date(record.clock_in_at).getTime()) / 3600000);
    }, 0)
  }), [records]);

  return (
    <>
      <SectionHeader
        eyebrow="ATTENDANCE"
        title="考勤记录"
        description="查询、修正和导出员工的上班、退勤及当日工作说明。"
        actions={
          <a
            className="button primary"
            href={`/api/admin/attendance/export.xlsx?start=${start}&end=${end}&employeeId=${employeeId}`}
          >
            <Download size={16} /> 导出 Excel
          </a>
        }
      />
      <div className="filter-bar">
        <label><span>开始日期</span><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label><span>结束日期</span><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label>
          <span>员工</span>
          <select value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
            <option value={0}>全部员工</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
          </select>
        </label>
        <button className="button secondary" type="button" onClick={() => void load()}><RefreshCw size={16} /> 查询</button>
      </div>
      <div className="metric-strip">
        <div><span>完整打卡</span><strong>{summary.complete}</strong></div>
        <div><span>缺少退勤</span><strong>{summary.missing}</strong></div>
        <div><span>累计时长</span><strong>{summary.totalHours.toFixed(1)}h</strong></div>
      </div>
      <div className="data-table-card">
        <table className="data-table">
          <thead><tr><th>日期</th><th>员工</th><th>上班</th><th>退勤</th><th>时长</th><th>状态</th><th>说明</th><th /></tr></thead>
          <tbody>
            {records.map((record) => {
              const duration = record.clock_in_at && record.clock_out_at
                ? (new Date(record.clock_out_at).getTime() - new Date(record.clock_in_at).getTime()) / 3600000
                : null;
              return (
                <tr key={record.id}>
                  <td data-label="日期">{record.attendance_date}</td>
                  <td data-label="员工"><strong>{record.name}</strong><small>{record.position}</small></td>
                  <td data-label="上班">{formatChinaTime(record.clock_in_at)}</td>
                  <td data-label="退勤">{formatChinaTime(record.clock_out_at)}</td>
                  <td data-label="时长">{duration == null ? "—" : `${duration.toFixed(1)}h`}</td>
                  <td data-label="状态">
                    <span className={`table-status ${record.clock_out_at ? "success" : "warning"}`}>
                      {record.clock_out_at ? "已退勤" : "缺少退勤"}
                    </span>
                  </td>
                  <td data-label="说明" className="note-cell">{record.checkout_note || "—"}</td>
                  <td><button className="icon-button" type="button" onClick={() => setEditing(record)}><Pencil size={15} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!records.length ? <div className="empty-panel">当前条件下没有考勤记录。</div> : null}
      </div>
      {editing ? (
        <AttendanceEditModal
          record={editing}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            await api(`/api/admin/attendance/${editing.id}`, { method: "PUT", body: jsonBody(value) });
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

function AttendanceEditModal({
  record,
  onClose,
  onSave
}: {
  record: AttendanceRecord;
  onClose: () => void;
  onSave: (value: { clockInAt: string; clockOutAt: string; checkoutNote: string; reason: string }) => Promise<void>;
}) {
  const [clockInAt, setClockInAt] = useState(toLocalInput(record.clock_in_at));
  const [clockOutAt, setClockOutAt] = useState(toLocalInput(record.clock_out_at));
  const [checkoutNote, setCheckoutNote] = useState(record.checkout_note);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Modal
      title={`修正考勤 · ${record.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button
            className="button primary"
            type="button"
            disabled={saving || !reason.trim()}
            onClick={async () => {
              setSaving(true);
              await onSave({ clockInAt, clockOutAt, checkoutNote, reason });
            }}
          ><Save size={16} /> 保存修正</button>
        </>
      }
    >
      <div className="info-note">{record.attendance_date} · 所有修正都会保留修改前后记录。</div>
      <label className="field"><span>上班时间</span><input type="datetime-local" value={clockInAt} onChange={(e) => setClockInAt(e.target.value)} /></label>
      <label className="field"><span>退勤时间</span><input type="datetime-local" value={clockOutAt} onChange={(e) => setClockOutAt(e.target.value)} /></label>
      <label className="field"><span>退勤说明</span><textarea rows={3} value={checkoutNote} onChange={(e) => setCheckoutNote(e.target.value)} /></label>
      <label className="field"><span>修正原因（必填）</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </Modal>
  );
}

function SettingsTab({ admin, onPasswordChanged }: { admin: AdminUser; onPasswordChanged: () => void }) {
  const [fallbackStartHour, setFallbackStartHour] = useState(9);
  const [fallbackEndHour, setFallbackEndHour] = useState(18);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [purgeStart, setPurgeStart] = useState(`${todayInChina().slice(0, 7)}-01`);
  const [purgeEnd, setPurgeEnd] = useState(todayInChina());
  const [purgeEmployeeIds, setPurgeEmployeeIds] = useState<number[]>([]);
  const [purgeTypes, setPurgeTypes] = useState(["attendance"]);
  const [purgePassword, setPurgePassword] = useState("");
  const [preview, setPreview] = useState<{ total: number; counts: Record<string, number> } | null>(null);
  const [passwordModal, setPasswordModal] = useState(false);

  useEffect(() => {
    void Promise.all([
      api<{ settings: { fallbackStartHour: number; fallbackEndHour: number } }>("/api/admin/settings"),
      api<{ employees: Employee[] }>("/api/admin/employees")
    ]).then(([settingsResult, employeeResult]) => {
      setFallbackStartHour(settingsResult.settings.fallbackStartHour);
      setFallbackEndHour(settingsResult.settings.fallbackEndHour);
      setEmployees(employeeResult.employees);
    });
  }, []);

  const purgePayload = {
    start: purgeStart,
    end: purgeEnd,
    employeeIds: purgeEmployeeIds,
    dataTypes: purgeTypes
  };

  return (
    <>
      <SectionHeader
        eyebrow="SYSTEM SETTINGS"
        title="系统设置"
        description="维护无任务日时间轴、管理员密码，以及受保护的历史数据清理。"
      />
      <div className="settings-grid">
        <section className="settings-card">
          <div className="settings-card-icon"><Clock3 size={21} /></div>
          <h2>默认时间轴</h2>
          <p>当所有员工当天都没有任务时使用。</p>
          <div className="inline-fields">
            <label className="field"><span>开始</span><select value={fallbackStartHour} onChange={(e) => setFallbackStartHour(Number(e.target.value))}>{hours.slice(0, -1).map((h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
            <label className="field"><span>结束</span><select value={fallbackEndHour} onChange={(e) => setFallbackEndHour(Number(e.target.value))}>{hours.slice(1).map((h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
          </div>
          <button
            className="button primary"
            type="button"
            onClick={() => api("/api/admin/settings", {
              method: "PUT",
              body: jsonBody({ fallbackStartHour, fallbackEndHour })
            })}
          ><Save size={16} /> 保存时间轴</button>
        </section>
        <section className="settings-card">
          <div className="settings-card-icon"><UserRoundCog size={21} /></div>
          <h2>管理员账号</h2>
          <p>当前账号：{admin.username}</p>
          {admin.mustChangePassword ? <div className="warning-note">正在使用初始密码，请立即修改。</div> : null}
          <button className="button secondary" type="button" onClick={() => setPasswordModal(true)}>修改管理员密码</button>
        </section>
      </div>
      <section className="danger-zone">
        <header><div className="danger-icon-large"><Database size={21} /></div><div><span className="eyebrow">DANGER ZONE</span><h2>清空历史数据</h2><p>按日期范围和员工永久删除历史记录，操作不可恢复。</p></div></header>
        <div className="purge-grid">
          <label className="field"><span>开始日期</span><input type="date" value={purgeStart} onChange={(e) => { setPurgeStart(e.target.value); setPreview(null); }} /></label>
          <label className="field"><span>结束日期</span><input type="date" value={purgeEnd} onChange={(e) => { setPurgeEnd(e.target.value); setPreview(null); }} /></label>
        </div>
        <fieldset className="check-list">
          <legend>员工（可多选）</legend>
          <div>{employees.map((employee) => <label key={employee.id}><input type="checkbox" checked={purgeEmployeeIds.includes(employee.id)} onChange={() => { setPreview(null); setPurgeEmployeeIds((current) => current.includes(employee.id) ? current.filter((id) => id !== employee.id) : [...current, employee.id]); }} />{employee.name}</label>)}</div>
        </fieldset>
        <fieldset className="check-list">
          <legend>数据类型</legend>
          <div>
            {[["attendance", "考勤与退勤"], ["additionalTasks", "新增任务"], ["dailyOverrides", "当天默认任务修改"]].map(([value, label]) => (
              <label key={value}><input type="checkbox" checked={purgeTypes.includes(value)} onChange={() => { setPreview(null); setPurgeTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]); }} />{label}</label>
            ))}
          </div>
        </fieldset>
        {preview ? <div className="purge-preview">预计永久删除 <strong>{preview.total}</strong> 条记录。</div> : null}
        <div className="danger-actions">
          <button
            className="button secondary"
            type="button"
            onClick={async () => setPreview(await api("/api/admin/purge/preview", { method: "POST", body: jsonBody(purgePayload) }))}
          >预览删除数量</button>
          {preview && preview.total > 0 ? (
            <>
              <input type="password" placeholder="再次输入管理员密码" value={purgePassword} onChange={(e) => setPurgePassword(e.target.value)} />
              <button
                className="button danger"
                type="button"
                onClick={async () => {
                  if (!window.confirm(`即将永久删除 ${preview.total} 条历史记录，确定继续吗？`)) return;
                  await api("/api/admin/purge/execute", {
                    method: "POST",
                    body: jsonBody({ ...purgePayload, password: purgePassword })
                  });
                  setPreview(null);
                  setPurgePassword("");
                }}
              ><Trash2 size={16} /> 永久删除</button>
            </>
          ) : null}
        </div>
      </section>
      {passwordModal ? <PasswordModal onClose={() => setPasswordModal(false)} onSaved={() => { setPasswordModal(false); onPasswordChanged(); }} /> : null}
    </>
  );
}

function PasswordModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      title="修改管理员密码"
      onClose={onClose}
      footer={
        <>
          <button className="button ghost" type="button" onClick={onClose}>取消</button>
          <button
            className="button primary"
            type="button"
            onClick={async () => {
              try {
                await api("/api/admin/password", {
                  method: "PUT",
                  body: jsonBody({ currentPassword, newPassword })
                });
                onSaved();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "修改失败");
              }
            }}
          ><Save size={16} /> 保存新密码</button>
        </>
      }
    >
      {error ? <div className="form-error">{error}</div> : null}
      <label className="field"><span>当前密码</span><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
      <label className="field"><span>新密码（至少 8 位）</span><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
    </Modal>
  );
}

export default function AdminPage() {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<AdminTab>("schedule");

  useEffect(() => {
    void api<{ admin: AdminUser }>("/api/admin/me")
      .then((result) => setAdmin(result.admin))
      .catch(() => setAdmin(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <main className="boot-screen"><div className="boot-mark">K</div><p>正在进入管理后台…</p></main>;
  if (!admin) return <AdminLogin onLogin={setAdmin} />;

  const navItems: Array<{ id: AdminTab; label: string; icon: ReactNode }> = [
    { id: "schedule", label: "每日安排", icon: <LayoutDashboard size={18} /> },
    { id: "employees", label: "员工模板", icon: <UsersRound size={18} /> },
    { id: "devices", label: "设备授权", icon: <MonitorSmartphone size={18} /> },
    { id: "attendance", label: "考勤记录", icon: <ClipboardList size={18} /> },
    { id: "settings", label: "系统设置", icon: <Settings size={18} /> }
  ];

  return (
    <main className="admin-app">
      <aside className="admin-sidebar">
        <div className="brand-lockup light">
          <div className="brand-mark">K</div>
          <div><span>KUMOHIRO</span><strong>DAKA</strong></div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
            >
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-account">
          <div><span className="person-avatar">管</span><span><strong>{admin.username}</strong><small>管理员</small></span></div>
          <button
            type="button"
            aria-label="退出登录"
            onClick={async () => {
              await api("/api/admin/logout", { method: "POST" });
              setAdmin(null);
            }}
          ><LogOut size={17} /></button>
        </div>
      </aside>
      <section className="admin-main">
        <div className="admin-mobile-bar">
          <div className="brand-lockup"><div className="brand-mark">K</div><strong>管理后台</strong></div>
          <span>{admin.username}</span>
        </div>
        <div className="admin-mobile-nav">
          {navItems.map((item) => (
            <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="admin-content">
          {tab === "schedule" ? <ScheduleTab /> : null}
          {tab === "employees" ? <EmployeesTab /> : null}
          {tab === "devices" ? <DevicesTab /> : null}
          {tab === "attendance" ? <AttendanceTab /> : null}
          {tab === "settings" ? <SettingsTab admin={admin} onPasswordChanged={() => setAdmin({ ...admin, mustChangePassword: false })} /> : null}
        </div>
      </section>
    </main>
  );
}
