import type { ViewMode } from "../lib/viewMode";
import styles from "./ViewModeSwitch.module.css";

export default function ViewModeSwitch({ value, onChange }: { value: ViewMode; onChange: (value: ViewMode) => void }) {
  return (
    <div className={styles.switch} role="group" aria-label="研究信息密度">
      <button type="button" aria-pressed={value === "basic"} onClick={() => onChange("basic")}>基础视图</button>
      <button type="button" aria-pressed={value === "pro"} onClick={() => onChange("pro")}>专业视图</button>
    </div>
  );
}
