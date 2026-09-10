export type TaskSource = "default" | "override" | "additional";

export interface Task {
  id: string;
  taskKey?: string;
  additionalTaskId?: number;
  source: TaskSource;
  employeeId: number;
  title: string;
  descriptionHtml: string;
  startHour: number;
  endHour: number;
  effectiveFrom?: string;
}

export interface AttendanceSummary {
  status: "not_started" | "working" | "checked_out";
  clockInAt?: string | null;
  clockOutAt?: string | null;
  checkoutNote?: string;
}

export interface EmployeeSchedule {
  id: number;
  name: string;
  position: string;
  active: boolean;
  display_order: number;
  isCurrent: boolean;
  tasks: Task[];
  attendance: AttendanceSummary;
}

export interface DaySchedule {
  date: string;
  holiday: { id: number; holiday_date: string; name: string } | null;
  range: { startHour: number; endHour: number };
  employees: EmployeeSchedule[];
}

export interface Employee {
  id: number;
  name: string;
  position: string;
  active: boolean;
  display_order: number;
  device_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface TemplateTask {
  id: number;
  taskKey: string;
  employeeId: number;
  title: string;
  descriptionHtml: string;
  startHour: number;
  endHour: number;
  weekdays: number[];
  effectiveFrom: string;
  active: boolean;
}

export interface Device {
  id: number;
  device_code: string;
  employee_id: number | null;
  employee_name: string | null;
  position: string | null;
  label: string;
  enabled: boolean;
  first_seen_at: string;
  last_seen_at: string;
  authorized_at: string | null;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  attendance_date: string;
  name: string;
  position: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  checkout_note: string;
  updated_at: string;
}

export type AttendanceDayStatus = "complete" | "working" | "incomplete" | "absent" | "rest" | "unscheduled" | "pending" | "future" | "untracked";

export interface AttendanceDay {
  date: string;
  status: AttendanceDayStatus;
  scheduled: boolean;
  holiday: string | null;
  record: AttendanceRecord | null;
  editable: boolean;
}

export interface AttendanceMonth {
  employee: Employee | null;
  today: string;
  month: string;
  firstMonth: string;
  currentMonth: string;
  days: AttendanceDay[];
}
