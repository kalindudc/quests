export interface ResolvedConfig {
  ids: { length: number };
  display: { pageSize: number; progressBarMaxWidth: number; icon: string; showStatus: boolean };
  shortcuts?: { openQuests?: string };
}

export const DEFAULT_CONFIG: ResolvedConfig = {
  ids: { length: 2 },
  display: { pageSize: 10, progressBarMaxWidth: 24, icon: "󰣏", showStatus: true },
  shortcuts: {},
};
