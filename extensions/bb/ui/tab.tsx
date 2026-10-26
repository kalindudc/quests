import { type ReactNode, useState } from "react";
import { nextQuest } from "../../../src/quest/progress.js";
import type { Quest, Step } from "../../../src/quest/types.js";
import { Button } from "../components/ui/button.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Icon } from "../components/ui/icon.js";
import { cn } from "../lib/utils.js";
import type { QuestMutation } from "../store.js";
import {
  messageOf,
  stepsOf,
  topLevel,
  useNow,
  useQuestChanges,
  useQuestLog,
  useQuietMinutes,
  useThreadRun,
} from "./data.js";
import {
  AgentChangedLine,
  IconButton,
  NextBadge,
  Notice,
  ProgressBar,
  TextForm,
  UnseenChanges,
} from "./parts.js";

type Change = (action: QuestMutation) => Promise<boolean>;

// Row controls stay out of the way until a row is hovered or focused; touch screens always show them.
const ROW_CONTROLS =
  "flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100";

function QuestRow({
  quest,
  isNext,
  deleteIds,
  change,
  pending,
  stepCount,
  children,
}: {
  quest: Quest | Step;
  isNext: boolean;
  deleteIds: string[];
  change: Change;
  pending: boolean;
  stepCount?: ReactNode;
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
          const saved = await change({ type: "update", id: quest.id, description });
          if (saved) setEditing(false);
          return saved;
        }}
      />
    );
  }

  const stepTotal = deleteIds.length - 1;
  return (
    <div
      className={cn(
        "group flex min-h-8 items-center gap-2 rounded-md px-2",
        isNext ? "bg-muted/60" : "hover:bg-muted/40",
      )}
    >
      <Checkbox
        checked={quest.done}
        disabled={pending}
        onCheckedChange={() => void change({ type: "toggle", id: quest.id })}
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
      {isNext ? <NextBadge /> : null}
      {stepCount}
      {confirmingDelete ? (
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {stepTotal > 0 ? `Delete with ${stepTotal} steps?` : "Delete?"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            aria-label={`Confirm deleting ${name}`}
            disabled={pending}
            onClick={() =>
              void change(
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
        </span>
      ) : (
        <span className={ROW_CONTROLS}>
          <span className="font-mono text-[10px] text-muted-foreground">{quest.id}</span>
          {children}
          <IconButton icon="Edit" label={`Edit ${name}`} onClick={() => setEditing(true)} />
          <IconButton
            icon="Trash2"
            label={`Delete ${name}`}
            onClick={() => setConfirmingDelete(true)}
          />
        </span>
      )}
    </div>
  );
}

function QuestItem({
  quest,
  steps,
  nextId,
  previousOpenId,
  nextOpenId,
  change,
  pending,
}: {
  quest: Quest;
  steps: Step[];
  nextId: string | null;
  previousOpenId?: string;
  nextOpenId?: string;
  change: Change;
  pending: boolean;
}) {
  const [addingStep, setAddingStep] = useState(false);
  const name = `"${quest.description}"`;
  const stepsDone = steps.filter((step) => step.done).length;

  return (
    <li>
      <QuestRow
        quest={quest}
        isNext={nextId === quest.id}
        deleteIds={[quest.id, ...steps.map((step) => step.id)]}
        change={change}
        pending={pending}
        stepCount={
          steps.length > 0 ? (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {stepsDone}/{steps.length}
            </span>
          ) : null
        }
      >
        {quest.done ? null : (
          <>
            <IconButton
              icon="ArrowUp"
              label={`Move ${name} up`}
              disabled={pending || previousOpenId === undefined}
              onClick={() => {
                if (previousOpenId)
                  void change({ type: "reorder", id: quest.id, targetId: previousOpenId });
              }}
            />
            <IconButton
              icon="ArrowDown"
              label={`Move ${name} down`}
              disabled={pending || nextOpenId === undefined}
              onClick={() => {
                if (nextOpenId)
                  void change({ type: "reorder", id: nextOpenId, targetId: quest.id });
              }}
            />
            <IconButton
              icon="Plus"
              label={`Add a step to ${name}`}
              onClick={() => setAddingStep(true)}
            />
          </>
        )}
      </QuestRow>
      {steps.length > 0 ? (
        <ul
          aria-label={`Steps of ${name}`}
          className="ml-4 flex flex-col border-l border-border pl-2"
        >
          {steps.map((step) => (
            <li key={step.id}>
              <QuestRow
                quest={step}
                isNext={nextId === step.id}
                deleteIds={[step.id]}
                change={change}
                pending={pending}
              />
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
              change({ type: "split", id: quest.id, descriptions: [description] })
            }
          />
        </div>
      ) : null}
    </li>
  );
}

export function QuestsTab({ threadId }: { threadId: string }) {
  const log = useQuestLog(threadId);
  const changes = useQuestChanges(threadId);
  const { running, canSteer } = useThreadRun(threadId);
  const quietMinutes = useQuietMinutes(threadId, log.data);
  const now = useNow(running);
  const [showDone, setShowDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const change: Change = async (action) => {
    if (changes.pending) return false;
    try {
      await changes.change(action);
      setFailure(null);
      return true;
    } catch (cause) {
      setFailure(messageOf(cause));
      return false;
    }
  };

  const error = failure ?? (log.error ? messageOf(log.error) : null);
  const alert =
    error === null ? null : (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  const view = log.data;
  if (view === undefined) return alert ?? <Notice>Loading quests…</Notice>;

  const quests = topLevel(view.quests);
  const open = quests.filter((quest) => !quest.done);
  const done = quests.filter((quest) => quest.done);
  const next = nextQuest(view.quests);
  const { done: doneCount, total } = view.progress;
  const pending = changes.pending;
  const item = (quest: Quest, index: number, siblings: Quest[]) => (
    <QuestItem
      key={quest.id}
      quest={quest}
      steps={stepsOf(view.quests, quest.id)}
      nextId={next?.quest.id ?? null}
      previousOpenId={siblings[index - 1]?.id}
      nextOpenId={siblings[index + 1]?.id}
      change={change}
      pending={pending}
    />
  );

  return (
    <section aria-label="Quests" className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-medium tabular-nums">
          {total === 0 ? "No quests" : `${doneCount} of ${total} done`}
        </span>
        <ProgressBar done={doneCount} total={total} className="flex-1" />
        <IconButton
          icon="ArrowTurnBackward"
          label="Undo"
          disabled={pending}
          onClick={() => void change({ type: "undo" })}
        />
        <IconButton
          icon="ArrowTurnForward"
          label="Redo"
          disabled={pending}
          onClick={() => void change({ type: "redo" })}
        />
        <IconButton
          icon="Clean"
          label="Clear done"
          disabled={pending || done.length === 0}
          onClick={() => void change({ type: "clear" })}
        />
      </div>
      {total > 0 ? (
        <AgentChangedLine
          agentChangedAt={view.agentChangedAt}
          quietMinutes={quietMinutes}
          now={now}
        />
      ) : null}
      <UnseenChanges
        count={view.unseenChanges}
        canTell={running && canSteer}
        telling={changes.telling}
        onTell={() => void changes.tell().catch((cause: unknown) => setFailure(messageOf(cause)))}
      />
      {alert}
      {quests.length === 0 ? (
        <Notice>
          No quests yet. Add one here, or ask the agent to track its work with quests.
        </Notice>
      ) : (
        <ul aria-label="Quest list" className="flex flex-col gap-0.5">
          {open.map((quest, index) => item(quest, index, open))}
        </ul>
      )}
      <TextForm
        label="New quest"
        placeholder="Add a quest"
        submitLabel="Add"
        disabled={pending}
        onSubmit={(description) => change({ type: "add", descriptions: [description] })}
      />
      {done.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={showDone}
            className="h-7 justify-start gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            onClick={() => setShowDone((value) => !value)}
          >
            <Icon
              name={showDone ? "ChevronDown" : "ChevronRight"}
              aria-hidden
              className="size-3.5"
            />
            Done · {done.length}
          </Button>
          {showDone ? (
            <ul aria-label="Done quests" className="flex flex-col gap-0.5">
              {done.map((quest, index) => item(quest, index, done))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
