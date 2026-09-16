import type { OpenmaTaskFile, OpenmaFilePreview } from "../shared/openma";
import type { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime";
export class OpenmaTaskFiles {
  constructor(private client: OpenManagedCloudRuntimeClient, private sessionId: string) {}
  async list(): Promise<OpenmaTaskFile[]> {
    const [outputs, resources] = await Promise.all([
      this.client.request(() => this.client.sdk.anthropic.get<{ data: Array<{ filename: string; size_bytes: number; media_type: string }> }>(`/v1/sessions/${encodeURIComponent(this.sessionId)}/outputs`)),
      this.client.request(async () => { const rows = []; for await (const resource of this.client.sdk.beta.sessions.resources.list(this.sessionId)) rows.push(resource); return rows; }),
    ]);
    return [
      ...(outputs.data ?? []).filter((file) => typeof file.filename === "string" && !/[\\/]/.test(file.filename) && !file.filename.includes("..")).map((file) => ({ id: `output:${file.filename}`, name: file.filename, size: file.size_bytes, mediaType: file.media_type })),
      ...resources.filter((resource) => resource.type === "file").map((file) => ({ id: `file:${file.file_id}`, name: file.mount_path?.split("/").at(-1) || file.file_id, path: file.mount_path })),
    ];
  }
  async read(id: string, limit = 64 * 1024 * 1024): Promise<{ file: OpenmaTaskFile; bytes: Uint8Array; mediaType: string }> {
    const file = (await this.list()).find((file) => file.id === id);
    if (!file) throw new Error("This file is not available in the remote task");
    const response = await this.client.request(() => id.startsWith("output:")
      ? this.client.sdk.anthropic.get<Response>(`/v1/sessions/${encodeURIComponent(this.sessionId)}/outputs/${encodeURIComponent(file.name)}`, { __binaryResponse: true })
      : this.client.sdk.beta.files.download(id.slice("file:".length)));
    if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new Error("File is too large to open here. Download it from OpenMA."); }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      if (reader) while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("File is too large to open here. Download it from OpenMA.");
        chunks.push(value);
      }
    } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    return { file, bytes: Buffer.concat(chunks), mediaType: response.headers.get("content-type")?.split(";")[0] ?? file.mediaType ?? "application/octet-stream" };
  }
  async preview(id: string): Promise<OpenmaFilePreview> {
    const { file, bytes, mediaType } = await this.read(id, 4 * 1024 * 1024);
    if (/^image\/(png|jpeg|webp|gif)$/.test(mediaType)) return { file, dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}` };
    if (mediaType.startsWith("text/") || /json|xml|javascript/.test(mediaType) || /\.(md|txt|csv|json|log|ya?ml|toml|py|[cm]?[jt]sx?)$/i.test(file.name)) return { file, text: new TextDecoder().decode(bytes) };
    return { file };
  }
}
