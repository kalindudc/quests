import type { PluginThreadHeaderActionProps, PluginThreadPanelProps } from "@get-bb/plugin-sdk";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Quest, Step } from "../../src/quest/types.js";
import { Button } from "./components/ui/button.js";
import { Checkbox } from "./components/ui/checkbox.js";
import { Icon } from "./components/ui/icon.js";
import { Input } from "./components/ui/input.js";
import { cn } from "./lib/utils.js";
import type { rpcContract } from "./server.js";
import type { QuestMutation, QuestView } from "./store.js";

type Mutate = (action: QuestMutation) => Promise<boolean>;

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isSignalFor(payload: unknown, threadId: string): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { threadId?: unknown }).threadId === threadId
  );
}

/** One thread's quest log, refetched whenever the server signals a write to that thread. */
function useQuestLog(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [view, setView] = useState<QuestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Answers can arrive out of order. A getLog answer counts only if no newer getLog started and no
  // change's answer landed after it was asked; a change's answer counts only if no getLog started
  // while it was in flight, since that getLog will see the change.
  const generation = useRef(0);
  const mutating = useRef(false);
  const lastConnection = useRef(connection);

  const refetch = useCallback(() => {
    const asked = ++generation.current;
    rpc.call("getLog", { threadId }).then(
      (next) => {
        if (asked !== generation.current) return;
        setView(next);
        setError(null);
      },
      (cause: unknown) => {
        if (asked === generation.current) setError(messageOf(cause));
      },
    );
  }, [rpc, threadId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useRealtime(
    "quests",
    useCallback(
      (payload: unknown) => {
        if (isSignalFor(payload, threadId)) refetch();
      },
      [threadId, refetch],
    ),
  );

  // Signals sent while the socket was down are not replayed, so catch up once it reconnects.
  useEffect(() => {
    if (connection === "connected" && lastConnection.current !== "connected") refetch();
    lastConnection.current = connection;
  }, [connection, refetch]);

  // One change at a time: a second submission while one is in flight is dropped, so a double
  // Undo cannot consume two history entries.
  const mutate = useCallback<Mutate>(
    async (action) => {
      if (mutating.current) return false;
      mutating.current = true;
      setPending(true);
      const asked = generation.current;
      try {
        const result = await rpc.call("mutate", { threadId, action });
        if (asked === generation.current) {
          generation.current += 1;
          setView(result.view);
          setError(null);
        }
        return true;
      } catch (cause) {
        setError(messageOf(cause));
        return false;
      } finally {
        mutating.current = false;
        setPending(false);
      }
    },
    [rpc, threadId],
  );

  return { view, error, pending, mutate };
}

function TextForm({
  label,
  placeholder,
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
  focusOnMount = false,
  disabled = false,
}: {
  label: string;
  placeholder?: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (text: string) => Promise<boolean>;
  onCancel?: () => void;
  focusOnMount?: boolean;
  disabled?: boolean;
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
        className="h-8"
      />
      <Button type="submit" size="sm" disabled={disabled || text.trim() === ""}>
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

function IconButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} aria-hidden className="size-4" />
    </Button>
  );
}

function QuestRow({
  quest,
  deleteIds,
  mutate,
  pending,
  children,
}: {
  quest: Quest | Step;
  deleteIds: string[];
  mutate: Mutate;
  pending: boolean;
  children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const name = `"${quest.description}"`;

  if (editing) {
    return (
      <TextForm
        label={`Edit ${name}`}
        initial={quest.description}
        submitLabel="Save"
        focusOnMount
        disabled={pending}
        onCancel={() => setEditing(false)}
        onSubmit={async (description) => {
          const saved = await mutate({ type: "update", id: quest.id, description });
          if (saved) setEditing(false);
          return saved;
        }}
      />
    );
  }

  const stepCount = deleteIds.length - 1;
  return (
    <div className="flex min-h-8 items-center gap-2">
      <Checkbox
        checked={quest.done}
        disabled={pending}
        onCheckedChange={() => void mutate({ type: "toggle", id: quest.id })}
        aria-label={`Mark ${name} ${quest.done ? "not done" : "done"}`}
      />
      <span
        className={cn(
          "min-w-0 flex-1 break-words",
          quest.done && "text-muted-foreground line-through",
        )}
      >
        {quest.description}
      </span>
      <span className="font-mono text-xs text-muted-foreground">{quest.id}</span>
      {confirmingDelete ? (
        <>
          <span className="text-xs text-muted-foreground">
            {stepCount > 0 ? `Delete with ${stepCount} steps?` : "Delete?"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            aria-label={`Confirm deleting ${name}`}
            disabled={pending}
            onClick={() =>
              void mutate(
                deleteIds.length === 1
                  ? { type: "delete", id: quest.id }
                  : { type: "delete", ids: deleteIds },
              )
            }
          >
            Delete
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </Button>
        </>
      ) : (
        <>
          {children}
          <IconButton icon="Edit" label={`Edit ${name}`} onClick={() => setEditing(true)} />
          <IconButton
            icon="Trash2"
            label={`Delete ${name}`}
            onClick={() => setConfirmingDelete(true)}
          />
        </>
      )}
    </div>
  );
}

function QuestItem({
  quest,
  steps,
  previousId,
  nextId,
  mutate,
  pending,
}: {
  quest: Quest;
  steps: Step[];
  previousId: string | undefined;
  nextId: string | undefined;
  mutate: Mutate;
  pending: boolean;
}) {
  const [addingStep, setAddingStep] = useState(false);
  const name = `"${quest.description}"`;

  return (
    <li className="px-3 py-2">
      <QuestRow
        quest={quest}
        deleteIds={[quest.id, ...steps.map((step) => step.id)]}
        mutate={mutate}
        pending={pending}
      >
        <IconButton
          icon="ArrowUp"
          label={`Move ${name} up`}
          disabled={pending || previousId === undefined}
          onClick={() => {
            if (previousId) void mutate({ type: "reorder", id: quest.id, targetId: previousId });
          }}
        />
        <IconButton
          icon="ArrowDown"
          label={`Move ${name} down`}
          disabled={pending || nextId === undefined}
          onClick={() => {
            if (nextId) void mutate({ type: "reorder", id: nextId, targetId: quest.id });
          }}
        />
        <IconButton
          icon="Plus"
          label={`Add a step to ${name}`}
          disabled={quest.done}
          onClick={() => setAddingStep(true)}
        />
      </QuestRow>
      {steps.length > 0 ? (
        <ul aria-label={`Steps of ${name}`} className="ml-6 mt-1 flex flex-col gap-1">
          {steps.map((step) => (
            <li key={step.id}>
              <QuestRow quest={step} deleteIds={[step.id]} mutate={mutate} pending={pending} />
            </li>
          ))}
        </ul>
      ) : null}
      {addingStep ? (
        <div className="ml-6 mt-1">
          <TextForm
            label={`New step for ${name}`}
            placeholder="Add a step"
            submitLabel="Add"
            focusOnMount
            disabled={pending}
            onCancel={() => setAddingStep(false)}
            onSubmit={(description) =>
              mutate({ type: "split", id: quest.id, descriptions: [description] })
            }
          />
        </div>
      ) : null}
    </li>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}

function QuestsPanel({ threadId }: PluginThreadPanelProps) {
  const { view, error, pending, mutate } = useQuestLog(threadId);

  const alert =
    error === null ? null : (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (view === null) return alert ?? <Notice>Loading quests…</Notice>;

  const quests = view.quests.filter((quest): quest is Quest => !("parentId" in quest));
  const stepsOf = (parentId: string) =>
    view.quests.filter(
      (quest): quest is Step => "parentId" in quest && quest.parentId === parentId,
    );
  const { done, total } = view.progress;

  return (
    <section aria-label="Quests" className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-auto text-muted-foreground">
          {total === 0 ? "No quests" : `${done} of ${total} done`}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => void mutate({ type: "undo" })}
        >
          <Icon name="ArrowTurnBackward" aria-hidden className="size-4" />
          Undo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => void mutate({ type: "redo" })}
        >
          <Icon name="ArrowTurnForward" aria-hidden className="size-4" />
          Redo
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending || !view.quests.some((quest) => quest.done)}
          onClick={() => void mutate({ type: "clear" })}
        >
          <Icon name="Clean" aria-hidden className="size-4" />
          Clear done
        </Button>
      </div>
      <TextForm
        label="New quest"
        placeholder="Add a quest"
        submitLabel="Add"
        disabled={pending}
        onSubmit={(description) => mutate({ type: "add", descriptions: [description] })}
      />
      {alert}
      {quests.length === 0 ? (
        <Notice>
          No quests yet. Add one here, or ask the agent to track its work with quests.
        </Notice>
      ) : (
        <ul
          aria-label="Quest list"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
        >
          {quests.map((quest, index) => (
            <QuestItem
              key={quest.id}
              quest={quest}
              steps={stepsOf(quest.id)}
              previousId={quests[index - 1]?.id}
              nextId={quests[index + 1]?.id}
              mutate={mutate}
              pending={pending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function QuestChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { view, error } = useQuestLog(threadId);
  const navigate = useBbNavigate();
  const progress = view?.progress;
  const active = progress !== undefined && progress.total > 0;

  let label = "No quests yet. Open quests";
  if (error !== null) label = `Quests could not load: ${error}. Open quests`;
  else if (active) {
    const next = progress.current === null ? "" : `, next: ${progress.current}`;
    label = `${progress.done} of ${progress.total} quests done${next}. Open quests`;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      className={cn("h-7 gap-1.5 px-2 tabular-nums", !active && "text-muted-foreground")}
      onClick={() => navigate.openThreadPanel({ actionId: "quests" })}
    >
      <Icon name={error === null ? "ListTodo" : "AlertCircle"} aria-hidden className="size-4" />
      {active ? `${progress.done}/${progress.total}` : isCompactViewport ? null : "quests"}
    </Button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "quests",
    title: "Quests",
    icon: "ListTodo",
    component: QuestsPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "quests-progress",
    title: "Quest progress",
    component: QuestChip,
  });
});
