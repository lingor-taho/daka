import { CheckCircle2, Clock3, LogOut, Plus } from "lucide-react";
import type { DaySchedule, EmployeeSchedule, Task } from "../types";

interface GanttBoardProps {
  schedule: DaySchedule;
  onTaskClick: (task: Task, employee: EmployeeSchedule) => void;
  onCheckout?: (employee: EmployeeSchedule) => void;
  onAddTask?: (employee: EmployeeSchedule) => void;
  admin?: boolean;
}

const defaultColors = ["mint", "sky", "indigo", "teal", "sage"];

function taskColor(task: Task, index: number) {
  if (task.source === "additional") return index % 2 ? "amber" : "coral";
  return defaultColors[index % defaultColors.length];
}

function layoutTasks(tasks: Task[]) {
  const laneEnds: number[] = [];
  return tasks.map((task) => {
    let lane = laneEnds.findIndex((end) => end <= task.startHour);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = task.endHour;
    return { task, lane };
  });
}

function attendanceLabel(employee: EmployeeSchedule) {
  if (employee.attendance.status === "checked_out") return "已退勤";
  if (employee.attendance.status === "working") return "工作中";
  return "未打卡";
}

export default function GanttBoard({
  schedule,
  onTaskClick,
  onCheckout,
  onAddTask,
  admin
}: GanttBoardProps) {
  const hours = Array.from(
    { length: schedule.range.endHour - schedule.range.startHour + 1 },
    (_, index) => schedule.range.startHour + index
  );
  const duration = Math.max(1, schedule.range.endHour - schedule.range.startHour);

  return (
    <div className="gantt-shell">
      <div
        className="gantt-board"
        style={{ "--hour-count": duration } as React.CSSProperties}
      >
        <div className="gantt-header gantt-person-head">
          <span>员工 / 岗位</span>
        </div>
        <div className="gantt-header gantt-time-head">
          {hours.map((hour, index) => (
            <span
              key={hour}
              className="hour-label"
              style={{ left: `${(index / duration) * 100}%` }}
            >
              {String(hour).padStart(2, "0")}:00
            </span>
          ))}
        </div>
        <div className="gantt-header gantt-status-head">状态 / 操作</div>

        {schedule.employees.map((employee) => {
          const laidOut = layoutTasks(employee.tasks);
          const laneCount = Math.max(1, ...laidOut.map((item) => item.lane + 1));
          const rowHeight = Math.max(68, laneCount * 48 + 16);
          return (
            <div className={`gantt-row-wrap ${employee.isCurrent ? "is-current" : ""}`} key={employee.id}>
              <div className="gantt-person" style={{ height: rowHeight }}>
                <div className="person-avatar">{employee.name.slice(0, 1)}</div>
                <div className="person-copy">
                  <strong>{employee.name}</strong>
                  <span>{employee.position || "未设置岗位"}</span>
                </div>
                {employee.isCurrent ? <em>我</em> : null}
              </div>
              <div className="gantt-track" style={{ height: rowHeight }}>
                {hours.slice(0, -1).map((hour, index) => (
                  <span
                    className="hour-gridline"
                    key={hour}
                    style={{ left: `${(index / duration) * 100}%` }}
                  />
                ))}
                {employee.tasks.length === 0 ? (
                  <div className="empty-row">今日暂无任务</div>
                ) : null}
                {laidOut.map(({ task, lane }, index) => (
                  <button
                    type="button"
                    key={task.id}
                    className={`task-bar task-${taskColor(task, index)} ${
                      task.source === "additional" ? "is-additional" : ""
                    }`}
                    style={{
                      left: `${((task.startHour - schedule.range.startHour) / duration) * 100}%`,
                      width: `${((task.endHour - task.startHour) / duration) * 100}%`,
                      top: lane * 48 + 8
                    }}
                    onClick={() => onTaskClick(task, employee)}
                    title={`${task.title} ${task.startHour}:00–${task.endHour}:00`}
                  >
                    <span>{task.title}</span>
                    <small>
                      {String(task.startHour).padStart(2, "0")}:00–
                      {String(task.endHour).padStart(2, "0")}:00
                    </small>
                    {task.source === "additional" ? <i>新增</i> : null}
                  </button>
                ))}
              </div>
              <div className="gantt-status" style={{ height: rowHeight }}>
                {admin && onAddTask ? (
                  <button className="mini-action" type="button" onClick={() => onAddTask(employee)}>
                    <Plus size={15} /> 新任务
                  </button>
                ) : employee.isCurrent && employee.attendance.status !== "checked_out" && onCheckout ? (
                  <button className="checkout-button" type="button" onClick={() => onCheckout(employee)}>
                    <LogOut size={16} /> 退勤
                  </button>
                ) : (
                  <span
                    className={`attendance-state state-${employee.attendance.status}`}
                    title={employee.isCurrent ? attendanceLabel(employee) : undefined}
                  >
                    {employee.attendance.status === "checked_out" ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <Clock3 size={15} />
                    )}
                    {attendanceLabel(employee)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

