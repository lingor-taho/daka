import { LogOut, Pause, Play } from "lucide-react";

export default function AttendanceActions({ paused, busy, onPauseToggle, onCheckout, mobile = false }: {
  paused: boolean;
  busy?: boolean;
  onPauseToggle: () => void;
  onCheckout: () => void;
  mobile?: boolean;
}) {
  return <div className={mobile ? "mobile-attendance-actions" : "attendance-actions"}>
    <button type="button" className={`pause-button${paused ? " is-paused" : ""}`} disabled={busy} onClick={onPauseToggle}
      title={paused ? "恢复工作计时" : "暂停工作计时"}>
      {paused ? <Play size={16} /> : <Pause size={16} />}{paused ? "恢复" : "暂停"}
    </button>
    <button type="button" className="checkout-button" disabled={busy} onClick={onCheckout}><LogOut size={16} />退勤</button>
  </div>;
}
