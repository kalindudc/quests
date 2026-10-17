import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const LOG_FILE = "/tmp/logs/pi-quests/debug.log";

let stream: ReturnType<typeof createWriteStream> | undefined;

function getStream() {
  if (!stream) {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    stream = createWriteStream(LOG_FILE, { flags: "a" });
    stream.on("error", () => {});
  }
  return stream;
}

export const logger = {
  debug: (namespace: string, event: string, meta?: Record<string, unknown>) => {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    const line = `[${timestamp}] [${namespace}] ${event}${metaStr}\n`;
    getStream().write(line);
  },
};
