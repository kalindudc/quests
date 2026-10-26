// Values the server and the page both use. It imports nothing, so zod stays out of the page bundle.

/** Every read of one thread's quests carries this tag; every change to them invalidates it. */
export const questTag = (threadId: string) => `quests:${threadId}`;

const ofThread = ({ threadId }: { threadId: string }) => [questTag(threadId)];

/** The query tags of each RPC method, spread into the server's contract and the page's copy. */
export const RPC_TAGS = {
  getLog: { tags: ofThread },
  mutate: { invalidates: ofThread },
  tell: { invalidates: ofThread },
} as const;

/**
 * Providers whose bb bridge adds a steered message to the running turn. An ACP bridge's steer
 * cancels the prompt instead, so threads on other providers never get a note.
 */
export const STEER_PROVIDERS: ReadonlySet<string> = new Set(["pi", "claude-code", "codex"]);

/** How long a working agent can leave its open quests unchanged before the page calls the log quiet. */
export const QUIET_AFTER_MS = 10 * 60 * 1000;
