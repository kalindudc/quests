import type { MessageRenderer, MessageRenderOptions, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Markdown } from "@earendil-works/pi-tui";
import { logger } from "../logger.js";

export const questChangelogRenderer: MessageRenderer<{ content: string }> = (
  message,
  _options: MessageRenderOptions,
  _theme: Theme,
): Component | undefined => {
  logger.debug("quest-changelog:renderer", "render-called", {
    hasDetails: !!message.details,
    hasContent: !!message.details?.content,
    contentLength: message.details?.content?.length ?? 0,
  });

  const data = message.details;
  if (!data?.content) {
    logger.debug("quest-changelog:renderer", "no-content-returning-undefined");
    return undefined;
  }

  logger.debug("quest-changelog:renderer", "creating-markdown");
  return new Markdown(data.content.trim(), 1, 1, getMarkdownTheme());
};
