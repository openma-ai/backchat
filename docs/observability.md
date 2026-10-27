# Observability

Backchat records two things locally on every run and can also export traces
to any OpenTelemetry collector over OTLP. Export is off by default.

## Local app log

`~/.oma/logs/backchat.log` holds one JSON record per line:

```json
{"timestamp":"…","level":"info","component":"main","event":"acp.session.ready","trace_id":"…","span_id":"…", …}
```

- `level` is `info`, `warn` or `error`. `component` is `main` or `renderer`.
- A record written inside an active span carries that span's `trace_id` and
  `span_id`, so log lines join their trace.
- The file rotates at 5 MB or at the first write of a new local day, to
  `backchat-YYYYMMDD-HHMMSS[-n].log`. Rotated files are kept for 7 days and
  25 MB in total; only files Backchat named are ever deleted.

## Spans

The main process owns the only tracer provider pipeline. Every finished span
is written to the app log as one `span.end` record, whether or not export is
on.

| Span | Process | Meaning |
| --- | --- | --- |
| `create_agent` | main | Session start until ready or start error. |
| `invoke_agent` | main | One agent turn, from `session.prompt_accepted` to its finish reason. |
| `execute_tool` | main | One tool call, child of its turn. |
| `ui.prompt.send` | renderer | The GUI action that sent a prompt; its turn's `invoke_agent` is a child. |
| `ui.turn.cancel` | renderer | A stop press; carries the session and turn it targeted, or `no_target`. |
| `ui.startup` | renderer | Renderer start until the first route resolves. |
| `ui.error` | renderer | An uncaught error or unhandled rejection: error type and route only. |
| `ui.long_frame` | renderer | A long animation frame of at least 100 ms. |

The ACP spans follow the OpenTelemetry GenAI semantic conventions and come
from `@openma/common/telemetry`.

### Cancel telemetry

Every stop press reaches the local log, so a cancelled turn can be followed
end to end:

| Record | Where | Meaning |
| --- | --- | --- |
| `session.cancel` | main | One cancel attempt: `session_id`, `turn_id` and an `outcome`. |
| `ui.turn.cancel` | renderer | The stop press and the turn it resolved. |

The `outcome` is one of `cancelled` (a live turn was aborted), `pending` (the
turn had not started; the cancel waits for its prompt), `start_aborted` (the
session start was cancelled), `ignored_settled` (the turn had already settled)
or `ignored_no_session` (no such session). Only ids and the outcome are
recorded — never prompt text.

Renderer spans cross IPC (`telemetry:exportSpans`) to the main process, which
validates and bounds them, attaches its own resource
(`service.name=backchat-renderer`) and feeds them to the same pipeline. The
renderer never sees the export endpoint or credentials.

### What spans never contain

Spans carry ids, names, kinds, counts and closed error codes only. Prompt
text, tool titles (they include paths and commands), file names and error
messages stay out of spans; when they are needed, they go to the local log
only.

## Exporting traces

Export needs the master switch `BACKCHAT_ENABLE_TELEMETRY=1` plus the standard
OpenTelemetry exporter variables:

| Key | Default |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` (`/v1/traces` is appended) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | used as is, overrides the above |
| `OTEL_EXPORTER_OTLP_PROTOCOL` / `…_TRACES_PROTOCOL` | `http/protobuf`; `http/json` is also supported |
| `OTEL_EXPORTER_OTLP_HEADERS` / `…_TRACES_HEADERS` | none; `key=value` pairs, comma separated |
| `OTEL_TRACES_EXPORTER` | `otlp`; `none` turns export off |
| `OTEL_SDK_DISABLED` | `true` turns export off |

Set them in the environment that launches Backchat, or in the `[telemetry]`
table of `~/.oma/config.toml`:

```toml
[telemetry]
BACKCHAT_ENABLE_TELEMETRY = "1"
OTEL_EXPORTER_OTLP_ENDPOINT = "https://collector.example.com"
OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer …"
```

A key in `[telemetry]` wins over the environment; an empty value there unsets
the environment variable (`BACKCHAT_ENABLE_TELEMETRY = ""` turns export off
even when the environment turns it on). Environment endpoint and header
variables never reach an endpoint chosen in settings. The `[telemetry]` table
is never sent to the renderer.

Each export decision is logged once as `app.telemetry`, for example
`{"exporting":true,"endpoint":"…/v1/traces","protocol":"http/json"}` or
`{"exporting":false,"reason":"telemetry_disabled"}`. Headers are never logged.
