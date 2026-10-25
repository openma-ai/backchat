# Temporary common SDK2 migration

`@openma__common@0.11.0.patch` is applied by pnpm and locked by hash. It
migrates the shared runtime and probes from the removed SDK1 connection class
to SDK2's v1 `/unstable` client builder; it also preserves notification-scoped
session IDs and changes matching declaration imports to `/unstable`.

This is an API migration, not a byte-stream protocol rewrite. Promote it to a
new common release and remove the patch once upstream includes these changes.
The runtime currently retains its existing session-control surface; child
cancellation is not offered by Backchat until a capability-gated native cancel
port is added. Do not use `_session` extension RPC to emulate it.
