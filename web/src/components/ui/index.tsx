import clsx from "clsx";
import { AlertTriangle, Inbox, Loader2, RefreshCw, X } from "lucide-react";
import {
  forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { errorMessage } from "../../lib/api";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-navy-900 text-white hover:bg-navy-800 disabled:bg-navy-300",
  secondary: "bg-white text-navy-900 ring-1 ring-inset ring-navy-200 hover:bg-navy-50 disabled:text-navy-300",
  ghost: "text-navy-700 hover:bg-navy-50 disabled:text-navy-300",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        "focus-ring inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-base",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("rounded-xl border border-navy-100 bg-white shadow-[0_1px_2px_rgb(11_31_68/0.05)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-navy-100 px-5 py-4">
      <div>
        <h3 className="text-base font-semibold text-navy-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-navy-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Badge({ className, children, tone = "navy" }: { className?: string; children: ReactNode; tone?: "navy" | "green" | "red" | "amber" | "cyan" | "gray" }) {
  const tones = {
    navy: "bg-navy-50 text-navy-700 ring-navy-200",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    red: "bg-red-50 text-red-700 ring-red-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    cyan: "bg-cyan-50 text-cyan-800 ring-cyan-200",
    gray: "bg-slate-50 text-slate-600 ring-slate-200",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", tones[tone], className)}>
      {children}
    </span>
  );
}

const fieldCls =
  "focus-ring block rounded-lg border border-navy-200 bg-white px-3 text-sm text-navy-900 placeholder:text-navy-300 disabled:bg-navy-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={clsx(fieldCls, "h-10", !className?.includes("w-") && "w-full", className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(fieldCls, "h-10 pr-8", !/(^|\s)w-/.test(className ?? "") && "w-full", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(fieldCls, "w-full py-2", className)} {...rest} />;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-navy-800">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-navy-500">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium text-navy-900">{label}</div>
        {description && <div className="text-sm text-navy-500">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx("focus-ring relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-navy-900" : "bg-navy-200")}
      >
        <span className={clsx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-5.5" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-navy-400", className)} />;
}

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-navy-500" role="status">
      <Spinner className="size-8" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-navy-100", className)} />;
}

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 rounded-full bg-navy-50 p-3 text-navy-400">{icon ?? <Inbox className="size-6" />}</div>
      <div className="font-semibold text-navy-900">{title}</div>
      {description && <p className="max-w-md text-sm text-navy-500">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50/50 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="size-7 text-red-600" />
      <div>
        <div className="font-semibold text-navy-900">We couldn’t load this data</div>
        <p className="mt-1 text-sm text-navy-600">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-navy-900 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg bg-navy-50 p-1" role="tablist">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={clsx(
            "focus-ring rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
            value === i.value ? "bg-white text-navy-900 shadow-sm" : "text-navy-500 hover:text-navy-800",
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "navy", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "navy" | "red" | "amber" | "green"; icon?: ReactNode }) {
  const tones = { navy: "text-navy-900", red: "text-red-600", amber: "text-amber-600", green: "text-emerald-600" };
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-sm font-medium text-navy-500">
        {label}
        {icon}
      </div>
      <div className={clsx("tabular mt-1 text-4xl font-extrabold", tones[tone])}>{value}</div>
      {hint && <div className="mt-1 text-xs text-navy-500">{hint}</div>}
    </Card>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className={clsx("relative max-h-[90vh] w-full overflow-auto rounded-2xl bg-white shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-navy-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
          <button onClick={onClose} className="focus-ring rounded-md p-1 text-navy-400 hover:bg-navy-50" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-navy-100 bg-navy-50/50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={clsx("whitespace-nowrap border-b border-navy-100 bg-navy-50/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-navy-500", className)}>
    {children}
  </th>
);
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={clsx("border-b border-navy-50 px-4 py-3 align-middle text-navy-800", className)}>
    {children}
  </td>
);

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}
