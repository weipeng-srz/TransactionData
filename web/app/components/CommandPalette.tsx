"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type CommandItem = { id: string; label: string; description: string; shortcut?: string; run: () => void };

export default function CommandPalette({ open, commands, onClose }: { open: boolean; commands: CommandItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return needle ? commands.filter((item) => `${item.label} ${item.description}`.toLocaleLowerCase("zh-CN").includes(needle)) : commands;
  }, [commands, query]);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  if (!open) return null;
  const close = () => { setQuery(""); setActive(0); onClose(); };
  const execute = (item: CommandItem | undefined) => { if (!item) return; close(); item.run(); };
  return (
    <div className="command-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="TickLens 命令中心" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(filtered.length - 1, value + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
        if (event.key === "Enter") { event.preventDefault(); execute(filtered[active]); }
      }}>
        <div className="command-search"><span>⌕</span><input ref={inputRef} value={query} placeholder="搜索股票、功能或研究章节…" aria-label="搜索命令" onChange={(event) => { setQuery(event.target.value); setActive(0); }} /><kbd>ESC</kbd></div>
        <div className="command-results" role="listbox" aria-label="可用命令">
          {filtered.map((item, index) => <button key={item.id} type="button" role="option" aria-selected={active === index} className={active === index ? "active" : ""} onMouseEnter={() => setActive(index)} onClick={() => execute(item)}><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.shortcut ? <kbd>{item.shortcut}</kbd> : null}</button>)}
          {!filtered.length ? <p>没有匹配的命令。</p> : null}
        </div>
        <footer><span>↑↓ 选择</span><span>↵ 执行</span><span>⌘K 打开</span></footer>
      </section>
    </div>
  );
}
