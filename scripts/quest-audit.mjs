#!/usr/bin/env node
// Measures how well bb agents keep their quest log current. It samples recent bb threads,
// replays each thread's event log and reports whether the agent planned with quests, how long
// it worked without touching the log, whether it closed quests as it went or all at the end,
// and whether follow-up requests from the user led to a log update.
//
// Run: node scripts/quest-audit.mjs [--since YYYY-MM-DD] [--limit N] [--json] (see --help)

import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs, promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WORK_ITEMS = new Set(["commandExecution", "fileChange", "fileRead", "imageView", "toolCall"]);
const MUTATING_ACTIONS = new Set([
  "add",
  "split",
  "add_step",
  "toggle",
  "update",
  "delete",
  "clear",
  "reparent",
  "undo",
  "redo",
  "reorder",
]);
const DEFAULT_PROVIDERS = ["pi", "claude-code", "codex"];
const TOGGLED_DONE = /^(?:Quest )?\[[0-9a-f]+\] done$/gm;
const TOGGLED_UNDONE = /^(?:Quest )?\[[0-9a-f]+\] undone$/gm;
const TAIL_SHARE = 0.15;
const FOLLOW_UP_WINDOW = 10;
const DOWNLOADS_AT_ONCE = 8;
const MAX_LOG_BYTES = 512 * 1024 * 1024;

const USAGE = `Usage: node scripts/quest-audit.mjs [options]

Samples bb threads and measures how well their agents kept the quest log current.

Options:
  --since YYYY-MM-DD   only threads created on or after this date (default: 7 days ago)
  --until YYYY-MM-DD   only threads created before this date (default: no end)
  --limit N            sample at most N threads (default: 120)
  --seed N             seed for the random sample, so reruns pick the same threads (default: 7)
  --min-work N         leave threads with fewer work actions out of the summary (default: 20)
  --providers LIST     comma-separated provider ids (default: ${DEFAULT_PROVIDERS.join(",")})
  --logs DIR           read <thread id>.json logs from DIR instead of downloading them
  --save DIR           write each downloaded log to DIR/<thread id>.json
  --json               print the per-thread metrics and the summary as one JSON object
  --help               show this help
`;

function localDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDate(date);
}

function wholeNumber(name, text) {
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value)) {
    throw new Error(`--${name} must be a whole number, got "${text}"`);
  }
  return value;
}

function dateMs(name, text) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!date) throw new Error(`--${name} must look like YYYY-MM-DD, got "${text}"`);
  const [, year, month, day] = date.map(Number);
  return new Date(year, month - 1, day).getTime();
}

function parseOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      since: { type: "string", default: daysAgo(7) },
      until: { type: "string" },
      limit: { type: "string", default: "120" },
      seed: { type: "string", default: "7" },
      "min-work": { type: "string", default: "20" },
      providers: { type: "string", default: DEFAULT_PROVIDERS.join(",") },
      logs: { type: "string" },
      save: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  return {
    help: values.help,
    since: values.since,
    sinceMs: dateMs("since", values.since),
    until: values.until ?? null,
    untilMs: values.until === undefined ? Number.POSITIVE_INFINITY : dateMs("until", values.until),
    limit: wholeNumber("limit", values.limit),
    seed: wholeNumber("seed", values.seed),
    minWork: wholeNumber("min-work", values["min-work"]),
    providers: values.providers
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean),
    logs: values.logs,
    save: values.save,
    json: values.json,
  };
}

async function bbJson(args) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("bb", args, { maxBuffer: MAX_LOG_BYTES }));
  } catch (error) {
    throw new Error(`bb ${args.join(" ")} failed: ${failureReason(error)}`);
  }
  const parsed = JSON.parse(stdout);
  if (parsed?.ok === false) throw new Error(parsed.error?.message ?? "bb reported an error");
  return { parsed, stdout };
}

function failureReason(error) {
  const text = parseJsonOrNull(error.stdout)?.error?.message ?? (error.stderr || error.message);
  return String(text).trim().split("\n")[0];
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function listThreads() {
  const lists = await Promise.all([
    bbJson(["thread", "list", "--json"]),
    bbJson(["thread", "list", "--json", "--archived"]),
  ]);
  const threads = new Map();
  for (const { parsed } of lists) {
    if (!Array.isArray(parsed)) throw new Error("bb thread list did not return a list");
    for (const thread of parsed) threads.set(thread.id, thread);
  }
  return threads;
}

async function listThreadsIfAvailable() {
  try {
    return await listThreads();
  } catch (error) {
    warn(`thread metadata unknown, so no provider or date filter applies: ${error.message}`);
    return new Map();
  }
}

async function logIdsIn(dir) {
  const names = await readdir(dir);
  return names.filter((name) => name.endsWith(".json")).map((name) => basename(name, ".json"));
}

function inSample(thread, options) {
  if (!thread) return true;
  return (
    options.providers.includes(thread.providerId) &&
    thread.createdAt >= options.sinceMs &&
    thread.createdAt < options.untilMs
  );
}

// Ranking by a seeded hash keeps earlier picks in the sample when new threads appear.
function sample(ids, limit, seed) {
  const ranked = ids.map((id) => ({ id, rank: seededHash(`${seed}:${id}`) }));
  ranked.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return ranked
    .slice(0, limit)
    .map(({ id }) => id)
    .sort();
}

function seededHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function mapWithLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function loadEvents(id, options) {
  let events;
  if (options.logs) {
    events = JSON.parse(await readFile(join(options.logs, `${id}.json`), "utf8"));
  } else {
    const { parsed, stdout } = await bbJson(["thread", "log", id, "--all", "--format", "json"]);
    events = parsed;
    if (options.save) await writeFile(join(options.save, `${id}.json`), stdout);
  }
  if (!Array.isArray(events)) throw new Error("the log is not a list of events");
  return events;
}

function questArguments(item) {
  let args = item.arguments || item.input || {};
  if (typeof args === "string") args = parseJsonOrNull(args);
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}

function resultText(item) {
  const result = item.result || item.output || "";
  if (Array.isArray(result)) {
    return result
      .map((part) => (part && typeof part === "object" ? (part.text ?? "") : String(part)))
      .join(" ");
  }
  return typeof result === "object" ? JSON.stringify(result) : String(result);
}

function isQuestCall(item) {
  return item.type === "toolCall" && String(item.tool || item.name || "").endsWith("quest");
}

// Positions count non-quest work actions, so a quest call at position 12 came after 12 of them.
function readTimeline(events) {
  let work = 0;
  const timeline = [];
  for (const event of events) {
    const data = event.data || {};
    if (event.type === "item/completed") {
      const item = data.item || {};
      if (!WORK_ITEMS.has(item.type)) continue;
      if (isQuestCall(item)) {
        timeline.push({
          order: timeline.length,
          at: work,
          kind: "quest",
          args: questArguments(item),
          result: resultText(item),
        });
      } else {
        work += 1;
      }
    } else if (event.type === "client/turn/requested") {
      timeline.push({
        order: timeline.length,
        at: work,
        kind: "request",
        initiator: data.initiator,
      });
    } else if (event.type === "turn/completed") {
      timeline.push({ order: timeline.length, at: work, kind: "turnEnd", status: data.status });
    }
  }
  return { work, timeline };
}

function countActions(questCalls) {
  const actions = {};
  for (const { args } of questCalls) {
    const action = String(args.action ?? null);
    actions[action] = (actions[action] ?? 0) + 1;
  }
  return actions;
}

function listOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function questIds(args) {
  if (listOrEmpty(args.ids).length > 0) return args.ids;
  return args.id ? [args.id] : [];
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

const NO_PLAN = {
  firstAddAt: null,
  created: null,
  completed: null,
  openAtEnd: null,
  maxSilentStretch: null,
  maxToggleBatch: null,
  tailCompletionShare: null,
  splitThenList: null,
  userRequestsAfterPlan: null,
  requestsFollowedByQuest: null,
};

function planMetrics(work, timeline, questCalls, firstAddAt) {
  let created = 0;
  let completed = 0;
  let open = 0;
  let lastChange = firstAddAt;
  let splitPending = false;
  let splitThenList = 0;
  const silentStretches = [];
  const toggleSizes = [];
  const completionPositions = [];

  for (const { at, args, result } of questCalls) {
    const action = args.action;
    if (action === "list" && splitPending) {
      splitThenList += 1;
      splitPending = false;
    }
    if (!MUTATING_ACTIONS.has(action)) continue;
    if (open > 0) silentStretches.push(at - lastChange);
    lastChange = at;

    if (action === "add" || action === "split" || action === "add_step") {
      const added = listOrEmpty(args.descriptions).length;
      created += added;
      open += added;
      if (action !== "add") splitPending = true;
    } else if (action === "toggle") {
      // Only the toggle's own lines count: "Quest [id] done" or "[id] undone" in a batch. The
      // user's changes and the plan line in newer results also contain "done".
      const done = Math.max(
        countMatches(result, TOGGLED_DONE) - countMatches(result, TOGGLED_UNDONE),
        0,
      );
      toggleSizes.push(questIds(args).length);
      completed += done;
      open -= done;
      for (let i = 0; i < done; i++) completionPositions.push(at);
    } else if (action === "delete") {
      const deleted = questIds(args).length;
      open -= deleted;
      created -= deleted;
    }
  }
  if (open > 0) silentStretches.push(work - lastChange);

  const tailStart = work - TAIL_SHARE * Math.max(work - firstAddAt, 1);
  const lateCompletions = completionPositions.filter((at) => at >= tailStart).length;
  const requests = timeline.filter(
    (entry) => entry.kind === "request" && entry.initiator === "user" && entry.at > firstAddAt,
  );
  const followed = requests.filter((request) =>
    questCalls.some(
      (call) => call.order > request.order && call.at <= request.at + FOLLOW_UP_WINDOW,
    ),
  );

  return {
    firstAddAt,
    created,
    completed,
    openAtEnd: Math.max(open, 0),
    maxSilentStretch: Math.max(0, ...silentStretches),
    maxToggleBatch: Math.max(0, ...toggleSizes),
    tailCompletionShare:
      completionPositions.length > 0 ? lateCompletions / completionPositions.length : null,
    splitThenList,
    userRequestsAfterPlan: requests.length,
    requestsFollowedByQuest: followed.length,
  };
}

function threadMetrics(id, events, thread) {
  const { work, timeline } = readTimeline(events);
  const questCalls = timeline.filter((entry) => entry.kind === "quest");
  const firstAdd = questCalls.find((call) => call.args.action === "add");
  const failedTurns = timeline.filter(
    (entry) =>
      entry.kind === "turnEnd" && (entry.status === "failed" || entry.status === "interrupted"),
  );
  return {
    thread: id,
    title: thread?.title ?? null,
    providerId: thread?.providerId ?? null,
    child: thread ? thread.parentThreadId != null : null,
    work,
    questCalls: questCalls.length,
    actions: countActions(questCalls),
    adopted: firstAdd !== undefined,
    ...(firstAdd ? planMetrics(work, timeline, questCalls, firstAdd.at) : NO_PLAN),
    failedTurns: failedTurns.length,
  };
}

async function auditThread(id, options, threads) {
  try {
    return threadMetrics(id, await loadEvents(id, options), threads.get(id));
  } catch (error) {
    warn(`skipping ${id}: ${error.message}`);
    return null;
  }
}

function ratio(count, of) {
  return { count, of };
}

function total(rows, key) {
  return rows.reduce((sum, row) => sum + row[key], 0);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(rows) {
  const adopted = rows.filter((row) => row.adopted);
  const completing = adopted.filter((row) => row.completed > 0);
  return {
    threads: rows.length,
    adoption: ratio(adopted.length, rows.length),
    closedMostlyAtEnd: ratio(
      completing.filter((row) => row.tailCompletionShare >= 0.5).length,
      completing.length,
    ),
    silentForHalfOrMore: ratio(
      adopted.filter((row) => row.maxSilentStretch >= row.work / 2).length,
      adopted.length,
    ),
    medianLongestSilentStretch: median(adopted.map((row) => row.maxSilentStretch)),
    followUpsTouchingLog: ratio(
      total(adopted, "requestsFollowedByQuest"),
      total(adopted, "userRequestsAfterPlan"),
    ),
  };
}

function summaryByKind(rows) {
  const summary = {
    all: summarize(rows),
    topLevel: summarize(rows.filter((row) => row.child === false)),
    child: summarize(rows.filter((row) => row.child === true)),
  };
  const unknown = rows.filter((row) => row.child === null);
  if (unknown.length > 0) summary.unknownKind = summarize(unknown);
  return summary;
}

function formatRatio({ count, of }) {
  const percent = of === 0 ? "n/a" : `${Math.round((100 * count) / of)}%`;
  return `${count}/${of} (${percent})`;
}

function sampleLine(sample) {
  const parts = [
    `Sample: ${sample.analysed} threads created since ${sample.since}${sample.until ? `, before ${sample.until}` : ""}`,
    `providers ${sample.providers.join(", ")}`,
    `seed ${sample.seed}`,
    `${sample.inScope} with at least ${sample.minWork} work actions`,
  ];
  if (sample.skipped > 0) parts.push(`${sample.skipped} skipped`);
  if (sample.unknownMetadata > 0) {
    parts.push(`${sample.unknownMetadata} with unknown metadata, not filtered`);
  }
  return `${parts.join("; ")}.`;
}

function kindLine(label, summary) {
  return [
    `${label} (${summary.threads}):`,
    `adoption ${formatRatio(summary.adoption)},`,
    `closed at the end ${formatRatio(summary.closedMostlyAtEnd)},`,
    `silent half or more ${formatRatio(summary.silentForHalfOrMore)},`,
    `follow-ups ${formatRatio(summary.followUpsTouchingLog)}`,
  ].join(" ");
}

const TABLE_COLUMNS = [
  ["thread", (row) => row.thread],
  ["provider", (row) => row.providerId ?? "?"],
  ["kind", (row) => (row.child === null ? "?" : row.child ? "child" : "top")],
  ["work", (row) => row.work],
  ["quests", (row) => row.questCalls],
  ["1st add", (row) => row.firstAddAt],
  ["created", (row) => row.created],
  ["done", (row) => row.completed],
  ["open", (row) => row.openAtEnd],
  ["silent", (row) => row.maxSilentStretch],
  ["batch", (row) => row.maxToggleBatch],
  [
    "late",
    (row) =>
      row.tailCompletionShare === null ? null : `${Math.round(100 * row.tailCompletionShare)}%`,
  ],
  [
    "follow-ups",
    (row) => (row.adopted ? `${row.requestsFollowedByQuest}/${row.userRequestsAfterPlan}` : null),
  ],
  ["failed", (row) => row.failedTurns],
  ["title", (row) => (row.title ?? "").slice(0, 50)],
];

function table(rows) {
  const cells = rows.map((row) => TABLE_COLUMNS.map(([, cell]) => String(cell(row) ?? "-")));
  const header = TABLE_COLUMNS.map(([name]) => name);
  const widths = header.map((name, column) =>
    Math.max(name.length, ...cells.map((line) => line[column].length)),
  );
  return [header, ...cells]
    .map((line) => line.map((cell, column) => cell.padEnd(widths[column])).join("  "))
    .map((line) => line.trimEnd());
}

function textReport({ sample, summary, threads }) {
  const { all } = summary;
  const median = all.medianLongestSilentStretch;
  const lines = [
    sampleLine(sample),
    `adoption:                         ${formatRatio(all.adoption)}`,
    `closed mostly at the end:         ${formatRatio(all.closedMostlyAtEnd)}`,
    `silent for half the thread+:      ${formatRatio(all.silentForHalfOrMore)}`,
    `median longest silent stretch:    ${median === null ? "n/a" : `${median} actions`}`,
    `follow-ups that touched the log:  ${formatRatio(all.followUpsTouchingLog)}`,
    kindLine("top-level threads", summary.topLevel),
    kindLine("child threads", summary.child),
  ];
  if (summary.unknownKind) lines.push(kindLine("unknown kind", summary.unknownKind));
  lines.push(
    "",
    `Per thread (threads under ${sample.minWork} work actions are left out of the summary):`,
  );
  lines.push(...table(threads));
  return `${lines.join("\n")}\n`;
}

function warn(message) {
  process.stderr.write(`quest-audit: ${message}\n`);
}

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    warn(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (options.save) await mkdir(options.save, { recursive: true });

  const threads = options.logs ? await listThreadsIfAvailable() : await listThreads();
  const ids = options.logs ? await logIdsIn(options.logs) : [...threads.keys()];
  const candidates = ids.filter((id) => inSample(threads.get(id), options));
  const chosen = sample(candidates, options.limit, options.seed);
  const audited = await mapWithLimit(chosen, DOWNLOADS_AT_ONCE, (id) =>
    auditThread(id, options, threads),
  );
  const rows = audited.filter((row) => row !== null);
  const inScope = rows.filter((row) => row.work >= options.minWork);

  const report = {
    sample: {
      source: options.logs ? `logs in ${options.logs}` : "bb",
      since: options.since,
      until: options.until,
      providers: options.providers,
      seed: options.seed,
      limit: options.limit,
      minWork: options.minWork,
      candidates: candidates.length,
      sampled: chosen.length,
      analysed: rows.length,
      skipped: chosen.length - rows.length,
      inScope: inScope.length,
      unknownMetadata: rows.filter((row) => row.child === null).length,
    },
    summary: summaryByKind(inScope),
    threads: rows,
  };
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : textReport(report));
}

main().catch((error) => {
  warn(error.message);
  process.exitCode = 1;
});
