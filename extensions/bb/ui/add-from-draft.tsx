import { useComposer } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { messageOf, useQuestChanges } from "./data.js";

export const ADD_FROM_DRAFT_POPUP = "add-as-quest";

/**
 * Opened from the send menu: the draft becomes a quest instead of a message, so the agent picks
 * it up without being interrupted. The user can trim the text before adding it. bb draws the
 * popup inside the composer's own form, so this uses no form of its own: a nested form's submit
 * would reach the composer's.
 */
export function AddFromDraft() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const changes = useQuestChanges(threadId ?? "");
  const [text, setText] = useState(() => composer.text.trim());
  const [failure, setFailure] = useState<string | null>(null);
  if (threadId === null) return null;

  const description = text.trim();
  const add = async () => {
    if (description === "" || changes.pending) return;
    try {
      await changes.change({ type: "add", descriptions: [description] });
      composer.replace({ text: "", mentions: [] });
      composer.experimental_closePopup();
    } catch (cause) {
      setFailure(messageOf(cause));
    }
  };

  return (
    <div className="flex flex-col gap-2 p-3 text-sm">
      <p className="text-muted-foreground">
        Add your draft to the quest log. The agent sees it without being interrupted.
        {composer.attachmentCount > 0
          ? " Quests hold text only, so your attachments stay in the composer."
          : null}
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              void add();
            } else if (event.key === "Escape") {
              composer.experimental_closePopup();
            }
          }}
          aria-label="Quest from your draft"
          className="h-8"
        />
        <Button
          type="button"
          size="sm"
          disabled={changes.pending || description === ""}
          onClick={() => void add()}
        >
          Add quest
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => composer.experimental_closePopup()}
        >
          Cancel
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="text-destructive">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
