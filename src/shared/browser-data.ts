export interface BrowserWebContentsInput {
  webContentsId: number;
}

export interface BrowserCredentialSummary {
  id: string;
  name: string;
  origin: string;
  username: string;
  createdAt: number;
}

export type BrowserDownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export interface BrowserDownloadInfo {
  id: string;
  fileName: string;
  url: string;
  savePath: string;
  state: BrowserDownloadState;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
}

export type BrowserClearDataKind = "history" | "cookies" | "cache" | "passwords";

export interface BrowserClearDataInput extends BrowserWebContentsInput {
  kinds: BrowserClearDataKind[];
}

export interface BrowserClearProfileDataInput {
  kinds: Array<Extract<BrowserClearDataKind, "cookies" | "cache">>;
}
