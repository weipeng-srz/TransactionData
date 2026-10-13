"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./ReviewDialog.module.css";

type ReviewDialogProps = { open: boolean; title: string; onClose: () => void; children: ReactNode; busy?: boolean };

export default function ReviewDialog({ open, title, onClose, children, busy = false }: ReviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    // Native dialogs supply focus containment, background inertness, and Escape.
    dialog.querySelector<HTMLInputElement>("input[data-field], textarea[data-field]")?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={styles.frame}>
      <header className={styles.header}><h2 id={titleId}>{title}</h2><button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="关闭复盘卡片">×</button></header>
      <div className={styles.content}>{children}</div>
    </div>
  </dialog>;
}
