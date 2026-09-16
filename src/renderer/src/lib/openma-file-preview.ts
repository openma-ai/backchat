import { toast } from "sonner";
export function showOpenmaFile(taskId: string, fileId: string): void {
  window.dispatchEvent(new CustomEvent("backchat:openma-file", { detail: { taskId, fileId } }));
}
export async function previewOpenmaFile(taskId: string, path: string): Promise<void> {
  try {
    const files = await window.backchat.openmaTaskFiles(taskId);
    const file = files.find((file) => file.path === path || file.id === path || file.name === path || path === `/mnt/data/${file.name}`);
    if (!file) throw new Error("This path has not been shared as a file by the remote task.");
    showOpenmaFile(taskId, file.id);
  } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't open the remote file"); }
}
