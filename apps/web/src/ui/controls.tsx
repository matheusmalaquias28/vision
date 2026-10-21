import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../editor/Icon";

/**
 * Vocabulário de controles do editor. Tudo segue o mesmo padrão de altura
 * (--ctl-h), raio e estados (hover/focus/disabled), estilo painel de
 * propriedades do After Effects: rótulo à esquerda, controle à direita.
 */

// ─── Linha de propriedade ────────────────────────────────────────────

export const Prop: React.FC<{
  label: string;
  hint?: string;
  /** Controle ocupa a linha inteira abaixo do rótulo (textos longos) */
  stacked?: boolean;
  children: React.ReactNode;
}> = ({ label, hint, stacked, children }) => (
  <div className={`prop ${stacked ? "prop-stacked" : ""}`}>
    <span className="prop-label" title={hint}>
      {label}
    </span>
    <div className="prop-control">{children}</div>
  </div>
);

// ─── Seção recolhível do inspetor ────────────────────────────────────

export const Section: React.FC<{
  title: string;
  /** Ações à direita do título (não alternam a seção) */
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, actions, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? "open" : ""}`}>
      <header className="section-head">
        <button
          className="section-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevronDown" size={12} className="section-chevron" />
          {title}
        </button>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
};

// ─── Controle segmentado (enums curtos) ──────────────────────────────

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : ""}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Número "arrastável" (hot text do After Effects) ─────────────────

function decimalsOf(step: number): number {
  const s = String(step);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

/**
 * Arraste horizontal muda o valor (Shift = 10×, Alt = fino); clique sem
 * arrastar abre a edição por teclado. Setas ↑/↓ também ajustam.
 */
export const ScrubNumber: React.FC<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Converte valor → texto exibido (ex.: 0.15 → "15") */
  format?: (v: number) => string;
  /** Converte texto digitado → valor (inverso de format) */
  parse?: (s: string) => number;
  /** Pixels de arraste por step */
  pxPerStep?: number;
  disabled?: boolean;
}> = ({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  format,
  parse,
  pxPerStep = 4,
  disabled,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);
  const dec = decimalsOf(step);
  const clamp = (v: number) => {
    const c = Math.min(max, Math.max(min, v));
    return Number(c.toFixed(dec));
  };
  const shown = format ? format(value) : value.toFixed(dec);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startValue = value;
    let moved = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) setDragging(true);
      moved = true;
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      onChange(clamp(startValue + Math.round(dx / pxPerStep) * step * mult));
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      setDragging(false);
      if (!moved) {
        setDraft(shown);
        setEditing(true);
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  if (editing) {
    return (
      <span className="scrub editing">
        <input
          autoFocus
          className="scrub-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => {
            setEditing(false);
            const raw = draft.replace(",", ".");
            const n = parse ? parse(raw) : Number(raw);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        {unit && <span className="scrub-unit">{unit}</span>}
      </span>
    );
  }

  return (
    <span
      className={`scrub ${dragging ? "dragging" : ""} ${disabled ? "disabled" : ""}`}
      tabIndex={disabled ? -1 : 0}
      role="spinbutton"
      aria-valuenow={value}
      title="Arraste para ajustar (Shift = rápido, Alt = fino) · clique para digitar"
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          onChange(clamp(value + step * (e.shiftKey ? 10 : 1)));
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(clamp(value - step * (e.shiftKey ? 10 : 1)));
        } else if (e.key === "Enter") {
          setDraft(shown);
          setEditing(true);
        }
      }}
    >
      <span className="scrub-value">{shown}</span>
      {unit && <span className="scrub-unit">{unit}</span>}
    </span>
  );
};

// ─── Slider com valor arrastável ao lado ─────────────────────────────

export const Slider: React.FC<{
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  format?: (v: number) => string;
  parse?: (s: string) => number;
}> = ({ value, onChange, min, max, step, unit, format, parse }) => {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <ScrubNumber
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        unit={unit}
        format={format}
        parse={parse}
      />
    </div>
  );
};

// ─── Toggle (booleanos) ──────────────────────────────────────────────

export const Toggle: React.FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}> = ({ checked, onChange, disabled, label }) => (
  <button
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    className={`toggle ${checked ? "on" : ""}`}
    onClick={() => onChange(!checked)}
  >
    <span className="toggle-knob" />
  </button>
);

// ─── Cor (amostra + hex) ─────────────────────────────────────────────

export const ColorField: React.FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => (
  <label className="color-field">
    <span className="color-swatch" style={{ background: value }} />
    <span className="color-hex">{value.toUpperCase()}</span>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

// ─── Select nativo estilizado (listas longas) ────────────────────────

export const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }
> = ({ className, children, ...rest }) => (
  <span className={`select ${className ?? ""}`}>
    <select {...rest}>{children}</select>
    <Icon name="chevronDown" size={12} className="select-chevron" />
  </span>
);

// ─── Abas ────────────────────────────────────────────────────────────

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T;
  tabs: { id: T; label: string; badge?: number }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          className={t.id === value ? "on" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge ? <span className="tab-badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ─── Popover (menus ancorados) ───────────────────────────────────────

/** Fecha ao clicar fora ou apertar Esc */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

/** Atalho de teclado exibido em botões/menus */
export const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="kbd">{children}</kbd>
);
