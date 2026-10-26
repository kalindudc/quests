import {
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadInfoProps,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { nextQuest } from "../../../src/quest/progress.js";
import { useQuestLog } from "./data.js";

/** One line in the thread Info tab: progress and the next item, opening the Quests tab. */
export function QuestsInfoRow({ threadId }: ExperimentalThreadInfoProps) {
  const { data } = useQuestLog(threadId);
  const navigate = useBbNavigate();
  if (data === undefined || data.progress.total === 0) return null;
  const next = nextQuest(data.quests);
  const detail = next === null ? "all done" : `next: ${next.quest.description}`;
  const progress = `${data.progress.done} of ${data.progress.total} done`;
  return (
    <DetailRow label="Quests" icon="ListTodo">
      <button
        type="button"
        aria-label={`Open the Quests tab: ${progress}, ${detail}`}
        className="min-w-0 truncate text-left hover:underline"
        onClick={() => navigate.openThreadPanel({ actionId: "quests" })}
      >
        <span className="tabular-nums">{progress}</span>
        <span className="text-muted-foreground"> · {detail}</span>
      </button>
    </DetailRow>
  );
}
