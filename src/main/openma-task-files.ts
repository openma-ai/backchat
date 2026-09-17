import { DirectAgentRuntime } from "./direct-agent-runtime.js";
import type { OpenmaTaskFile, OpenmaFilePreview } from "../shared/openma";
import type { OpenManagedCloudRuntimeClient } from "./openmanaged-cloud-runtime";
export class OpenmaTaskFiles {
  constructor(private client: OpenManagedCloudRuntimeClient | DirectAgentRuntime, private sessionId: string) {}
  async list(): Promise<OpenmaTaskFile[]> {
    if (this.client instanceof DirectAgentRuntime) {
      const client = this.client;
      return client.request(async () => {
        const files: OpenmaTaskFile[] = [];
        if (client.options.provider === "openai-agents") {
          for await (const file of client.openai.beta.agents.sessions.artifacts.list(this.sessionId)) files.push({ id: file.id, name: file.path.split("/").at(-1) || file.id, path: file.path, size: file.size_bytes });
        } else {
          for await (const file of client.claude.beta.sessions.resources.list(this.sessionId)) if (file.type === "file") files.push({ id: file.file_id, name: file.mount_path?.split("/").at(-1) || file.file_id, path: file.mount_path });
        }
        return files;
      });
    }
    const client = this.client;
    const [outputs, resources] = await Promise.all([
      this.client.request(() => client.sdk.anthropic.get<{ data: Array<{ filename: string; size_bytes: number; media_type: string }> }>(`/v1/sessions/${encodeURIComponent(this.sessionId)}/outputs`)),
      this.client.request(async () => { const rows = []; for await (const resource of client.sdk.beta.sessions.resources.list(this.sessionId)) rows.push(resource); return rows; }),
    ]);
    return [
      ...(outputs.data ?? []).filter((file) => typeof file.filename === "string" && !/[\\/]/.test(file.filename) && !file.filename.includes("..")).map((file) => ({ id: `output:${file.filename}`, name: file.filename, size: file.size_bytes, mediaType: file.media_type })),
      ...resources.filter((resource) => resource.type === "file").map((file) => ({ id: `file:${file.file_id}`, name: file.mount_path?.split("/").at(-1) || file.file_id, path: file.mount_path })),
    ];
  }
  async read(id: string, limit = 64 * 1024 * 1024): Promise<{ file: OpenmaTaskFile; bytes: Uint8Array; mediaType: string }> {
    const file = (await this.list()).find((file) => file.id === id);
    if (!file) throw new Error("This file is not available in the remote task");
    const client = this.client;
    const response = await client.request(() => client instanceof DirectAgentRuntime
      ? client.options.provider === "openai-agents" ? client.openai.beta.agents.sessions.artifacts.content(id, { session_id: this.sessionId }) : client.claude.beta.files.download(id)
      : id.startsWith("output:")
      ? client.sdk.anthropic.get<Response>(`/v1/sessions/${encodeURIComponent(this.sessionId)}/outputs/${encodeURIComponent(file.name)}`, { __binaryResponse: true })
      : client.sdk.beta.files.download(id.slice("file:".length)));
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
