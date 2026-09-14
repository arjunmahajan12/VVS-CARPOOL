import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { renderIcon, type IconSlot } from "./icon";

/* Shared props for every field. */
export interface FieldBaseProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Icon inside the control on the left. */
  leftIcon?: IconSlot;
  /** Node inside the control on the right (unit, button, counter). */
  rightSlot?: ReactNode;
  /** Wrapper class. */
  wrapperClassName?: string;
  /** Small text on the right of the label (e.g. "Optional"). */
  labelRight?: ReactNode;
}

const CONTROL =
  "w-full min-h-11 rounded-md bg-card text-base text-ink-900 placeholder:text-ink-500/80 " +
  "shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-[box-shadow,background-color] duration-150 " +
  "focus:shadow-[inset_0_0_0_2px_var(--color-primary)] focus-visible:outline-none " +
  "disabled:opacity-60 disabled:bg-card-2";
const ERR = "shadow-[inset_0_0_0_1.5px_var(--color-danger)] focus:shadow-[inset_0_0_0_2px_var(--color-danger)]";

function Shell({
  id, label, hint, error, labelRight, wrapperClassName, leftIcon, rightSlot, children,
}: FieldBaseProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("grid gap-1.5", wrapperClassName)}>
      {(label || labelRight) && (
        <div className="flex items-baseline justify-between gap-2 px-0.5">
          {label && <label htmlFor={id} className="text-sm font-semibold text-ink-700">{label}</label>}
          {labelRight && <span className="text-xs text-ink-500">{labelRight}</span>}
        </div>
      )}
      <div className="relative">
        {leftIcon && (
          <span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500">
            {renderIcon(leftIcon, 18, 2)}
          </span>
        )}
        {children}
        {rightSlot && <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center text-sm text-ink-500">{rightSlot}</span>}
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="px-0.5 text-sm font-medium text-danger-ink">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="px-0.5 text-sm text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, error?: ReactNode, hint?: ReactNode) {
  return error ? `${id}-err` : hint ? `${id}-hint` : undefined;
}

/* ---------------------------------------------------------------- Input */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">, FieldBaseProps {
  ref?: Ref<HTMLInputElement>;
}
export function Input({ id: idProp, label, hint, error, leftIcon, rightSlot, labelRight, wrapperClassName, className, ...rest }: InputProps) {
  const auto = useId();
  const id = idProp ?? auto;
  const numeric = rest.type === "number" || rest.type === "tel" || rest.inputMode === "numeric" || rest.inputMode === "decimal";
  return (
    <Shell {...{ id, label, hint, error, leftIcon, rightSlot, labelRight, wrapperClassName }}>
      <input
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(CONTROL, "px-3.5", leftIcon && "pl-10.5", rightSlot && "pr-11", numeric && "tnum", error && ERR, className)}
        {...rest}
      />
    </Shell>
  );
}

/* --------------------------------------------------------------- Select */
export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">, FieldBaseProps {
  options?: SelectOption[];
  placeholder?: string;
  ref?: Ref<HTMLSelectElement>;
}
export function Select({ id: idProp, label, hint, error, leftIcon, labelRight, wrapperClassName, className, options, placeholder, children, ...rest }: SelectProps) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <Shell {...{ id, label, hint, error, leftIcon, labelRight, wrapperClassName }}
      rightSlot={<ChevronDown size={18} strokeWidth={2.25} className="pointer-events-none" aria-hidden />}
    >
      <select
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(CONTROL, "appearance-none px-3.5 pr-10", leftIcon && "pl-10.5", error && ERR, className)}
        {...rest}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options?.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        {children}
      </select>
    </Shell>
  );
}

/* ------------------------------------------------------------- Textarea */
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldBaseProps {
  ref?: Ref<HTMLTextAreaElement>;
}
export function Textarea({ id: idProp, label, hint, error, leftIcon, rightSlot, labelRight, wrapperClassName, className, rows = 3, ...rest }: TextareaProps) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <Shell {...{ id, label, hint, error, leftIcon, rightSlot, labelRight, wrapperClassName }}>
      <textarea
        id={id} rows={rows}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(CONTROL, "resize-y px-3.5 py-2.5 leading-[22px]", leftIcon && "pl-10.5", error && ERR, className)}
        {...rest}
      />
    </Shell>
  );
}
