# Shared daemon connection snapshot

`src/daemon-connection.ts` is an unmodified snapshot of OpenMA's
`packages/managed-agents-runtime/src/daemon-connection.ts`. The CLI consumes
that canonical source; Backchat bundles this snapshot to build without a
sibling checkout. It has no Electron, Node, or process-manager dependencies.

Update the file as a unit from OpenMA. Do not edit transport policy here.
The source and snapshot must match byte for byte. Verify from this repository:

```sh
cmp packages/openma-runtime/src/daemon-connection.ts ../open-managed-agents/packages/managed-agents-runtime/src/daemon-connection.ts
```

The shared module owns connection identity, greetings, heartbeat timeouts,
reconnect and shutdown. Session execution, storage, project directories and
the host's process lifetime remain provided by their existing adapters.
It is a shared connection implementation, not a standalone daemon binary.
