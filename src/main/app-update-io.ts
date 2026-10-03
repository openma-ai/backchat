import { createHash, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { once } from "node:events";
import {
  parseUpdateIdentity,
  UpdateError,
  type UpdateIdentity,
} from "../shared/app-update.js";

export async function readIdentityFile(path: string, version: string): Promise<UpdateIdentity> {
  try {
    const text = await readFile(path, "utf8");
    return parseUpdateIdentity(JSON.parse(text) as unknown, version);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || error instanceof SyntaxError) {
      return parseUpdateIdentity(undefined, version);
    }
    throw error;
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const data = await readFile(path);
  hash.update(data);
  return hash.digest("hex");
}

export function sha256Matches(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Streams `url` to `destination`, then keeps the file only when the byte
 * count and sha256 match. A mismatch deletes the partial download.
 */
export async function downloadVerifiedFile(options: {
  url: string;
  sha256: string;
  size: number;
  destination: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const partial = `${options.destination}.partial`;
  await mkdir(dirname(options.destination), { recursive: true });
  await rm(partial, { force: true });
  let response: Response;
  try {
    response = await fetchImpl(options.url, { signal: options.signal, redirect: "follow" });
  } catch (error) {
    throw new UpdateError("network", error instanceof Error ? error.message : "download failed");
  }
  if (!response.ok || !response.body) {
    throw new UpdateError("network", `download failed with status ${response.status}`);
  }

  const hash = createHash("sha256");
  const file = createWriteStream(partial, { flags: "wx" });
  let received = 0;
  try {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = chunk.value;
      received += bytes.byteLength;
      if (received > options.size) {
        throw new UpdateError("sha256", "download is larger than the manifest size");
      }
      hash.update(bytes);
      if (!file.write(bytes)) await once(file, "drain");
    }
    file.end();
    await once(file, "finish");
  } catch (error) {
    file.destroy();
    await rm(partial, { force: true });
    if (error instanceof UpdateError) throw error;
    throw new UpdateError("network", error instanceof Error ? error.message : "download failed");
  }

  if (received !== options.size) {
    await rm(partial, { force: true });
    throw new UpdateError("sha256", "download size does not match the manifest");
  }
  const actual = hash.digest("hex");
  if (!sha256Matches(actual, options.sha256)) {
    await rm(partial, { force: true });
    throw new UpdateError("sha256", "download sha256 does not match the manifest");
  }
  await rm(options.destination, { force: true });
  await rename(partial, options.destination);
  const written = await stat(options.destination);
  if (written.size !== options.size) {
    await rm(options.destination, { force: true });
    throw new UpdateError("sha256", "stored download size does not match the manifest");
  }
}
