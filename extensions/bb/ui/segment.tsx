import {
  type ExperimentalThreadContextSegmentInput,
  type ExperimentalThreadContextSegmentProps,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { nextQuest } from "../../../src/quest/progress.js";
import { Checkbox } from "../components/ui/checkbox.js";
import { Icon } from "../components/ui/icon.js";
import { cn } from "../lib/utils.js";
import {
  messageOf,
  shortAge,
  stepsOf,
  topLevel,
  useNow,
  useQuestChanges,
  useQuestLog,
  useQuietMinutes,
  useThreadRun,
} from "./data.js";
import { AgentChangedLine, NextBadge, ProgressBar, TextForm, UnseenChanges } from "./parts.js";

// Room for the next item's name beside at most two other segments; a fuller row gets the count.
const ROOMY_SEGMENTS = 3;
const SHOWN_STEPS = 3;

/** The segment shows while any quest is open or the agent has unseen changes to hear about. */
export function useQuestsSegmentVisible({
  threadId,
}: ExperimentalThreadContextSegmentInput): boolean {
  const { data } = useQuestLog(threadId);
  return data !== undefined && (data.unseenChanges > 0 || data.quests.some((quest) => !quest.done));
}

export function QuestsSegmentSummary({
  threadId,
  segments,
  isExpanded,
  onToggle,
}: ExperimentalThreadContextSegmentProps) {
  const { data } = useQuestLog(threadId);
  const quietMinutes = useQuietMinutes(threadId, data);
  if (data === undefined) return null;
  const { done, total } = data.progress;
  const next = nextQuest(data.quests);
  const roomy = segments.length <= ROOMY_SEGMENTS;
  const parts = [`${done} of ${total} quests done`];
  if (next !== null) parts.push(`next: ${next.quest.description}`);
  if (quietMinutes !== null)
    parts.push(`no quest change for ${quietMinutes} minutes while the agent works`);
  if (data.unseenChanges > 0)
    parts.push(`${data.unseenChanges} of your changes not seen by the agent`);

  return (
    <button
      type="button"
      data-segment-summary
      aria-expanded={isExpanded}
      aria-label={`Quests: ${parts.join(", ")}`}
      onClick={onToggle}
      className={cn(
        "flex min-h-6 min-w-0 shrink-0 items-center gap-1.5 overflow-hidden rounded px-2 py-1 text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        roomy ? "max-w-[60%]" : "",
        isExpanded ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon name="ListTodo" aria-hidden className="size-3.5 shrink-0" />
      <span className="shrink-0 tabular-nums">
        {done}/{total}
      </span>
      {roomy && next !== null ? (
        <>
          <span aria-hidden data-promptbox-hide-compact="">
            ·
          </span>
          <span className="min-w-0 truncate" data-promptbox-hide-compact="">
            {next.quest.description}
          </span>
        </>
      ) : null}
      {quietMinutes !== null ? (
        <span className="flex shrink-0 items-center gap-0.5 text-amber-700 dark:text-amber-400">
          <Icon name="Clock" aria-hidden className="size-3" />
          {roomy ? shortAge(quietMinutes) : null}
        </span>
      ) : null}
      {data.unseenChanges > 0 ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
      ) : null}
    </button>
  );
}

export function QuestsSegmentDetails({
  threadId,
  isExpanded,
}: ExperimentalThreadContextSegmentProps) {
  const { data } = useQuestLog(threadId);
  const changes = useQuestChanges(threadId);
  const { running, canSteer } = useThreadRun(threadId);
  const quietMinutes = useQuietMinutes(threadId, data);
  const now = useNow(isExpanded && running);
  const navigate = useBbNavigate();
  const [showDone, setShowDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!isExpanded || data === undefined) return null;

  const change = async (action: Parameters<typeof changes.change>[0]) => {
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
  const next = nextQuest(data.quests);
  const quests = topLevel(data.quests);
  const open = quests.filter((quest) => !quest.done);
  const done = quests.filter((quest) => quest.done);
  const row = (quest: (typeof data.quests)[number], indent: boolean, trailing?: string) => (
    <li
      key={quest.id}
      className={cn(
        "flex min-h-6 items-center gap-2 rounded px-1 py-0.5",
        indent && "pl-6",
        next?.quest.id === quest.id && "bg-muted/60",
      )}
    >
      <Checkbox
        checked={quest.done}
        disabled={changes.pending}
        onCheckedChange={() => void change({ type: "toggle", id: quest.id })}
        aria-label={`Mark "${quest.description}" ${quest.done ? "not done" : "done"}`}
        className="size-3.5"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          quest.done && "text-muted-foreground line-through",
        )}
        title={quest.description}
      >
        {quest.description}
      </span>
      {next?.quest.id === quest.id ? <NextBadge /> : null}
      {trailing ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">{trailing}</span>
      ) : null}
    </li>
  );

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2 pt-1.5 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="shrink-0 tabular-nums">
          {data.progress.done} of {data.progress.total} done
        </span>
        <ProgressBar done={data.progress.done} total={data.progress.total} className="w-24" />
        <span className="flex-1" />
        <button
          type="button"
          className="shrink-0 underline underline-offset-2 hover:text-foreground"
          onClick={() => navigate.openThreadPanel({ actionId: "quests" })}
        >
          Open the Quests tab
        </button>
      </div>
      {quietMinutes !== null ? (
        <AgentChangedLine
          agentChangedAt={data.agentChangedAt}
          quietMinutes={quietMinutes}
          now={now}
        />
      ) : null}
      <UnseenChanges
        count={data.unseenChanges}
        canTell={running && canSteer}
        telling={changes.telling}
        onTell={() => void changes.tell().catch((cause: unknown) => setFailure(messageOf(cause)))}
      />
      {failure ? (
        <p role="alert" className="text-destructive">
          {failure}
        </p>
      ) : null}
      <ul aria-label="Open quests" className="flex max-h-40 flex-col overflow-y-auto">
        {open.flatMap((quest) => {
          const steps = stepsOf(data.quests, quest.id);
          const stepsDone = steps.filter((step) => step.done).length;
          const rows = [
            row(quest, false, steps.length > 0 ? `${stepsDone}/${steps.length}` : undefined),
          ];
          if (next?.parent?.id === quest.id) {
            const openSteps = steps.filter((step) => !step.done);
            rows.push(...openSteps.slice(0, SHOWN_STEPS).map((step) => row(step, true)));
            if (openSteps.length > SHOWN_STEPS) {
              rows.push(
                <li key={`${quest.id}-more`} className="pl-6 text-muted-foreground">
                  +{openSteps.length - SHOWN_STEPS} more steps
                </li>,
              );
            }
          }
          return rows;
        })}
        {done.length > 0 ? (
          <li>
            <button
              type="button"
              aria-expanded={showDone}
              className="flex items-center gap-1 px-1 py-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setShowDone((value) => !value)}
            >
              <Icon
                name={showDone ? "ChevronDown" : "ChevronRight"}
                aria-hidden
                className="size-3"
              />
              {done.length} done
            </button>
          </li>
        ) : null}
        {showDone ? done.map((quest) => row(quest, false)) : null}
      </ul>
      <TextForm
        label="New quest"
        placeholder="Add a quest"
        submitLabel="Add"
        compact
        disabled={changes.pending}
        onSubmit={(description) => change({ type: "add", descriptions: [description] })}
      />
    </div>
  );
}
