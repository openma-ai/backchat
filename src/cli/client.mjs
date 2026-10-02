import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export function controlSocketPath(env = process.env, platform = process.platform) {
  const override = env.BACKCHAT_CONTROL_SOCK;
  if (override && override.trim()) return override.trim();
  if (platform === "win32") {
    const user = (env.USERNAME || env.USER || "user").replace(/[^A-Za-z0-9_.-]/g, "_");
    return `\\\\.\\pipe\\backchat-control-${user}`;
  }
  const testHome = env.BACKCHAT_HOME;
  const root = env.BACKCHAT_TEST_HOOKS === "1" && testHome
    ? testHome
    : join(homedir(), ".oma");
  return join(root, "control.sock");
}

export function callControl({ socketPath, method, params, client }) {
  const payload = JSON.stringify({
    method,
    params: params ?? {},
    ...(client ? { client } : {}),
  });
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath,
      path: "/v1/call",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      },
    }, (res) => {
      const chunks = [];
      res.setEncoding("utf8");
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = chunks.join("");
        let body;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          reject(Object.assign(new Error(text || "Control server returned invalid JSON"), { code: "error" }));
          return;
        }
        if (body.ok) {
          resolve(body.result);
          return;
        }
        const code = body.error?.code || "error";
        const message = body.error?.message || "Control request failed";
        reject(Object.assign(new Error(message), { code, result: body.result }));
      });
    });
    req.on("error", (error) => {
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED" || error.code === "ECONNRESET") {
        reject(Object.assign(new Error(
          `Backchat is not running. Start the app and try again.\nControl socket: ${socketPath}`,
        ), { code: "app_not_running" }));
        return;
      }
      reject(Object.assign(new Error(error.message), { code: "error" }));
    });
    req.write(payload);
    req.end();
  });
}
