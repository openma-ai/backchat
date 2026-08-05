import { toast } from "sonner";
import { markdownFileLabel, markdownFileUrl } from "./markdown-link-target";
import { sessionStore } from "./session-store";

/** Preview locally when possible, while retaining the source file for Open in. */
export async function previewLocalFile(path: string): Promise<void> {
  try {
    const preview = await window.backchat.uiFsResolvePreview({ path });
    if (preview) {
      const tabId = sessionStore.openSideTab(
        "browser",
        markdownFileUrl(preview.previewPath),
        markdownFileLabel(preview.sourcePath),
      );
      sessionStore.patchSideTab(tabId, { sourcePath: preview.sourcePath });
      return;
    }
    sessionStore.openSideTab("artifact", path, markdownFileLabel(path));
  } catch (error) {
    toast.error("Couldn't open file", {
      description: `${path}\n\n${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
