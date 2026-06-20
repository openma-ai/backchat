# Pet App Integrations

The standalone pet app integrates with agent harnesses through small adapters
rather than by coupling the pet renderer to one desktop product.

## Attribution Policy

The Codex/Backchat pet integration may use open source projects as references
for hook installation, session discovery, notification, and ack behavior. When a
project only informs the design, record the project in `THIRD_PARTY_NOTICES.md`.

If source code is copied, adapted, or translated from another project, the
change must also preserve the upstream license and copyright notice in the
affected file or in `THIRD_PARTY_NOTICES.md`.

## Current References

- clawd-on-desk: reference for hook/session handling and completion ack patterns.

## Dependency License Reports

For release packaging, generate dependency license data from pnpm instead of
hand-maintaining dependency notices:

```bash
pnpm licenses list --prod --json
```

If a generated notice file is needed later, prefer adding a dedicated release
script that consumes this JSON and writes a deterministic artifact.

