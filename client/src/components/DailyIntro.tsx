import { useEffect, useState } from "react";
import { todayInTimeZone, useAppTimeZone } from "../timeZone";

const STORAGE_KEY = "kumohiro_daka_daily_intro";

function hasSeenToday(dateKey: string) {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === dateKey;
  } catch {
    return false;
  }
}

export default function DailyIntro() {
  const { displayTimeZone } = useAppTimeZone();
  const dateKey = todayInTimeZone(displayTimeZone);
  const [phase, setPhase] = useState<"visible" | "leaving" | "hidden">(() =>
    hasSeenToday(dateKey) ? "hidden" : "visible"
  );

  useEffect(() => {
    if (phase === "visible") {
      try {
        window.localStorage.setItem(STORAGE_KEY, dateKey);
      } catch {
        // 浏览器禁用本地存储时，仍允许本次动画正常播放。
      }
      const timer = window.setTimeout(() => setPhase("leaving"), 4_200);
      return () => window.clearTimeout(timer);
    }
    if (phase === "leaving") {
      const timer = window.setTimeout(() => setPhase("hidden"), 700);
      return () => window.clearTimeout(timer);
    }
  }, [dateKey, phase]);

  if (phase === "hidden") return null;

  function close() {
    setPhase("leaving");
  }

  return (
    <section
      className={`daily-intro ${phase === "leaving" ? "is-leaving" : ""}`}
      aria-label="每日问候"
      role="status"
    >
      <div className="intro-sky-glow" />
      <div className="intro-spark intro-spark-one">✦</div>
      <div className="intro-spark intro-spark-two">✧</div>
      <div className="intro-spark intro-spark-three">✦</div>

      <div className="intro-cloud intro-cloud-one">
        <i />
        <i />
      </div>
      <div className="intro-cloud intro-cloud-two">
        <i />
        <i />
      </div>

      <div className="intro-sun-orbit">
        <div className="intro-rays" />
        <div className="intro-sun">
          <span />
          <span />
        </div>
      </div>

      <div className="intro-landscape">
        <div className="intro-mountain intro-mountain-back" />
        <div className="intro-mountain intro-mountain-front" />
        <div className="intro-field" />
      </div>

      <div className="intro-message">
        <span>GOOD MORNING</span>
        <h1>新的一天开始了</h1>
        <p>大家要开心哦～</p>
      </div>

      <button type="button" className="intro-skip" onClick={close}>
        进入工作看板
      </button>
    </section>
  );
}
