import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button.js";
import { Icon } from "../components/ui/icon.js";
import { Input } from "../components/ui/input.js";
import { cn } from "../lib/utils.js";

export function TextForm({
  label,
  placeholder,
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
  focusOnMount = false,
  disabled = false,
  compact = false,
}: {
  label: string;
  placeholder?: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel?: () => void;
  focusOnMount?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusOnMount) input.current?.focus();
  }, [focusOnMount]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = text.trim();
    if (next === "" || disabled) return;
    const saved = await onSubmit(next);
    if (saved && initial === "") setText("");
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        ref={input}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel?.();
        }}
        placeholder={placeholder}
        aria-label={label}
        className={compact ? "h-7 text-xs" : "h-8"}
      />
      <Button
        type="submit"
        size="sm"
        variant={compact ? "ghost" : "default"}
        className={compact ? "h-7 px-2 text-xs" : undefined}
        disabled={disabled || text.trim() === ""}
      >
        {submitLabel}
      </Button>
      {onCancel ? (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      ) : null}
    </form>
  );
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
  className,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-7 shrink-0 text-muted-foreground hover:text-foreground", className)}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} aria-hidden className="size-4" />
    </Button>
  );
}

export function ProgressBar({
  done,
  total,
  className,
}: {
  done: number;
  total: number;
  className?: string;
}) {
  const percent = total === 0 ? 0 : Math.round((100 * done) / total);
  return (
    <div
      role="progressbar"
      aria-label="Quests done"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className={cn("h-1 overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function NextBadge() {
  return (
    <span className="shrink-0 rounded-full border border-foreground px-1.5 text-[10px] font-semibold leading-4">
      Next
    </span>
  );
}

/** Says when the agent last changed the log, in the warning tone once it has gone quiet. */
export function AgentChangedLine({
  agentChangedAt,
  quietMinutes,
  now,
}: {
  agentChangedAt: number | null;
  quietMinutes: number | null;
  now: number;
}) {
  const text =
    agentChangedAt === null
      ? "The agent has not changed the log yet."
      : `The agent last changed the log ${ago(now - agentChangedAt)}${quietMinutes !== null ? " and is still working" : ""}.`;
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs",
        quietMinutes !== null ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      <Icon name="Clock" aria-hidden className="size-3.5 shrink-0" />
      {text}
    </p>
  );
}

function ago(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The user's edits the agent has not seen, with a way to send them into a running turn. */
export function UnseenChanges({
  count,
  canTell,
  telling,
  onTell,
}: {
  count: number;
  canTell: boolean;
  telling: boolean;
  onTell: () => void;
}) {
  if (count === 0) return null;
  const changes = count === 1 ? "1 change" : `${count} changes`;
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-foreground"
    >
      <Icon name="MailOpen" aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {canTell
          ? `${changes} the agent hasn't seen yet.`
          : `${changes} the agent hasn't seen. It sees them with your next message or its next quest call.`}
      </span>
      {canTell ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs underline"
          disabled={telling}
          onClick={onTell}
        >
          Tell it now
        </Button>
      ) : null}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}
