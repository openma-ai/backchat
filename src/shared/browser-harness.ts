/** Renderer/main contract for the task-scoped in-app browser. In product
 *  language a task is a browser window; each window owns several tab ids. */
export interface BrowserViewRegistrationInput {
  sessionId: string;
  tabId: string;
  webContentsId: number;
  active: boolean;
}

export interface BrowserViewIdentityInput {
  sessionId: string;
  tabId: string;
  webContentsId: number;
}

export type BrowserUiCommand =
  | {
      action: "open";
      sessionId: string;
      tabId: string;
      url: string;
    }
  | {
      action: "activate" | "close";
      sessionId: string;
      tabId: string;
    };
