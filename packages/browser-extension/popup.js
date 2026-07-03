const statusNode = document.querySelector("[data-status]");
const pauseToggle = document.querySelector("[data-pause-toggle]");
const portInput = document.querySelector("[data-port-input]");
const diagnosticsNode = document.querySelector("[data-diagnostics]");
const refreshButton = document.querySelector("[data-refresh]");
const savePortButton = document.querySelector("[data-save-port]");
const copyDiagnosticsButton = document.querySelector("[data-copy-diagnostics]");

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "Backchat bridge did not respond");
  }
  return response.result;
}

function renderStatus(status) {
  const connectedText = status.status === "connected"
    ? "Connected"
    : status.status === "paused"
      ? "Paused"
      : "Disconnected";
  const suffix = status.lastError ? ` - ${status.lastError}` : "";
  statusNode.textContent = `${connectedText} on port ${status.bridgePort}${suffix}`;
  pauseToggle.checked = status.paused !== true;
  portInput.value = String(status.bridgePort ?? "");
  diagnosticsNode.value = JSON.stringify({
    status: status.status,
    paused: status.paused,
    bridgePort: status.bridgePort,
    extensionId: status.extensionId,
    extensionVersion: status.extensionVersion,
    instanceId: status.instanceId,
    lastConnectedAt: status.lastConnectedAt,
    lastCommandAt: status.lastCommandAt,
    lastCommandType: status.lastCommandType,
    lastError: status.lastError,
  }, null, 2);
}

async function refresh() {
  try {
    renderStatus(await send({ type: "bridge.status" }));
  } catch (error) {
    statusNode.textContent = String(error?.message ?? error);
  }
}

pauseToggle.addEventListener("change", async () => {
  await send({ type: "bridge.setPaused", paused: pauseToggle.checked !== true });
  await refresh();
});

savePortButton.addEventListener("click", async () => {
  const port = Number(portInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    statusNode.textContent = "Port must be between 1 and 65535";
    return;
  }
  await send({ type: "bridge.setPort", port });
  await refresh();
});

refreshButton.addEventListener("click", refresh);

copyDiagnosticsButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(diagnosticsNode.value);
});

await refresh();
