import {
  definePluginApp,
  experimental_THREAD_INFO_ROW_GROUPS as INFO_ROW_GROUPS,
  experimental_THREAD_CONTEXT_SEGMENT_GROUPS as SEGMENT_GROUPS,
} from "@get-bb/plugin-sdk/app";
import { ADD_FROM_DRAFT_POPUP, AddFromDraft } from "./ui/add-from-draft.js";
import { QuestsInfoRow } from "./ui/info.js";
import {
  QuestsSegmentDetails,
  QuestsSegmentSummary,
  useQuestsSegmentVisible,
} from "./ui/segment.js";
import { QuestsTab } from "./ui/tab.js";

export const QUESTS_TAB_ID = "quests";

export default definePluginApp((app) => {
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: QUESTS_TAB_ID,
    title: "Quests",
    icon: "ListTodo",
    component: QuestsTab,
  });
  // In bb's thread group, right after the parent thread and ahead of pull requests and files.
  app.slots.experimental_threadContextSegment({
    id: "quests",
    title: "Quests",
    group: SEGMENT_GROUPS.thread,
    order: 20,
    summary: QuestsSegmentSummary,
    details: QuestsSegmentDetails,
    useVisible: useQuestsSegmentVisible,
  });
  app.slots.experimental_threadInfoRow({
    id: "quests",
    group: INFO_ROW_GROUPS.thread,
    order: 90,
    component: QuestsInfoRow,
  });
  app.composer.customize({
    id: "quests",
    scopes: ["thread"],
    sendMenu: [
      {
        id: "add-as-quest",
        label: "Add as a quest",
        icon: "ListTodo",
        description: "Puts the draft on the quest log without interrupting the agent",
        disabled: (composer) => composer.isEmpty,
        run: ({ composer }) => {
          composer.experimental_openPopup(ADD_FROM_DRAFT_POPUP);
        },
      },
    ],
    experimental_popups: [
      { id: ADD_FROM_DRAFT_POPUP, label: "Add as a quest", component: AddFromDraft },
    ],
  });
  app.commands.register({
    id: "open-quests",
    title: "Open the Quests tab",
    defaultShortcut: { key: "l", mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: QUESTS_TAB_ID });
    },
  });
});
