"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import styles from "./logs.module.css";

/**
 * A record's actions, floating at the bottom of the page so they stay in reach while reading.
 * It must be the last thing in the record: it rests there once the end is reached.
 */
export function ActionDock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.dock} role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * A dock button that opens a panel above it. Opening moves focus into the panel, which comes before its
 * button, so Tab goes on to the panel's own controls. Escape or a click elsewhere closes it; focus goes
 * back to the button on Escape.
 */
export function DockPanel({ label, title, children }: { label: ReactNode; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      // A choice list or dialog an ant control opens sits outside the box but belongs to the panel.
      if (!box.current?.contains(target) && !target?.closest(".ant-select-dropdown, .ant-picker-dropdown, .ant-modal-root")) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")) return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className={styles.dockItem} ref={box}>
      {open && (
        <div id={id} ref={panel} tabIndex={-1} className={styles.dockPanel} role="dialog" aria-label={title}>
          {children}
        </div>
      )}
      <button
        ref={button}
        type="button"
        className={`${styles.dockButton}${open ? ` ${styles.on}` : ""}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
    </div>
  );
}
