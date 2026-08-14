import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ActivityIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  CloudIcon,
  LoaderCircleIcon,
  LockKeyholeIcon,
  NetworkIcon,
  PlayIcon,
  RadioIcon,
  SquareIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusNotice } from "@/components/ui/status-notice";
import { Textarea } from "@/components/ui/textarea";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type {
  ManagedAgentsLabEvent,
  ManagedAgentsLabModelOption,
} from "@shared/managed-agents-lab";
import {
  initialManagedAgentsLabState,
  reduceManagedAgentsLabEvent,
} from "./managed-agents-lab-state";

const DEFAULT_ENDPOINT = "https://app.staging.openma.dev";
const DEFAULT_MODEL = "openai/gpt-5.4";
const DEFAULT_TASK =
  "Create /workspace/hello.py, make it print a short greeting from Backchat, then run it and report the output.";

const terminalStatuses = new Set(["completed", "cancelled", "error", "idle"]);

export function ManagedAgentsLabPage() {
  const { t } = useI18n();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_ENDPOINT);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelOptions, setModelOptions] = useState<ManagedAgentsLabModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const modelRequest = useRef(0);
  const [prompt, setPrompt] = useState(DEFAULT_TASK);
  const [state, setState] = useState(initialManagedAgentsLabState);

  useEffect(() => window.backchat.onManagedAgentsLabEvent((event) => {
    setState((current) => reduceManagedAgentsLabEvent(current, event));
  }), []);

  const running = !terminalStatuses.has(state.status);
  const protocol = useMemo(
    () => [...state.http, ...state.sdkEvents].sort((a, b) => a.at - b.at),
    [state.http, state.sdkEvents],
  );

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setState({ ...initialManagedAgentsLabState, status: "connecting" });
    try {
      const { runId } = await window.backchat.managedAgentsLabStart({
        baseUrl,
        apiKey,
        model,
        prompt,
      });
      setState((current) => current.runId
        ? current
        : { ...current, runId });
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const stop = async () => {
    if (!state.runId) return;
    await window.backchat.managedAgentsLabCancel({ runId: state.runId });
  };

  const discoverModels = async () => {
    if (!baseUrl.trim() || !apiKey.trim()) return;
    const request = ++modelRequest.current;
    setModelsLoading(true);
    setModelsError(null);
    try {
      const options = await window.backchat.managedAgentsLabModels({ baseUrl, apiKey });
      if (request !== modelRequest.current) return;
      setModelOptions(options);
      setModel((current) => {
        if (options.some((option) => option.id === current)) return current;
        return options[0]?.id ?? current;
      });
    } catch (error) {
      if (request !== modelRequest.current) return;
      setModelOptions([]);
      setModelsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (request === modelRequest.current) setModelsLoading(false);
    }
  };

  const statusKey = `managedLab.status.${state.status}` as TranslationKey;

  return (
    <div className="h-full overflow-y-auto rounded-2xl bg-bg/80 shadow-card-soft">
      <div className="mx-auto w-full max-w-[1320px] px-5 pb-12 pt-7 sm:px-8 sm:pt-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CloudIcon className="size-4 text-info" aria-hidden="true" />
              <h1 className="text-base font-medium text-fg">{t("managedLab.title")}</h1>
              <Badge variant="outline" className="h-5 font-mono text-[9px] text-fg-muted">
                {t("managedLab.officialSdk")}
              </Badge>
            </div>
            <p className="mt-1 max-w-[72ch] text-[11px] leading-5 text-fg-muted">
              {t("managedLab.description")}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-fg-subtle">
            <span className={cn(
              "size-1.5 rounded-full",
              running ? "animate-pulse bg-info" : state.status === "completed" ? "bg-success" : "bg-fg-subtle/50",
            )} />
            {t(statusKey)}
          </div>
        </header>

        <div className="mt-[calc(var(--row-gap-y)*2)] flex flex-wrap items-center gap-x-[var(--page-pl)] gap-y-[var(--row-gap-y)] text-xs text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <LockKeyholeIcon className="size-3 text-success" aria-hidden="true" />
            {t("managedLab.mainProcessBoundary")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <NetworkIcon className="size-3 text-info" aria-hidden="true" />
            HTTPS control plane + SSE event stream
          </span>
          {(state.result || state.http.some((item) => item.status === 501)) && (
            <span className="inline-flex items-center gap-1.5 text-warning">
              <CheckCircle2Icon className="size-3" aria-hidden="true" />
              {t("managedLab.tunnelUnsupported")}
            </span>
          )}
        </div>

        <section className="mt-[calc(var(--page-pl)*2)] grid gap-[calc(var(--page-pl)*2)] lg:min-h-[610px] lg:grid-cols-[minmax(280px,0.72fr)_minmax(460px,1.28fr)]">
          <form
            data-testid="managed-lab-config"
            onSubmit={(event) => void start(event)}
            className="flex min-w-0 flex-col px-[var(--page-pl)] pb-[calc(var(--page-pl)*1.5)] lg:py-[var(--row-gap-y)] lg:pl-[var(--page-pl)] lg:pr-0"
          >
            <div>
              <h2 className="text-xs font-medium text-fg">Configure run</h2>
              <p className="mt-1 text-[10px] leading-4 text-fg-subtle">
                One temporary agent, environment, and session per run.
              </p>
            </div>

            <div className="mt-[calc(var(--row-gap-y)*2.5)] space-y-[calc(var(--row-gap-y)*2)]">
              <Field label={t("managedLab.endpoint")} htmlFor="managed-lab-endpoint">
                <Input
                  id="managed-lab-endpoint"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  disabled={running}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
              </Field>
              <Field label={t("managedLab.apiKey")} htmlFor="managed-lab-key">
                <Input
                  id="managed-lab-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  disabled={running}
                  autoComplete="off"
                  placeholder="oma_…"
                  className="font-mono text-xs"
                />
                <p className="mt-1.5 flex items-start gap-1.5 text-[9px] leading-4 text-fg-subtle">
                  <LockKeyholeIcon className="mt-0.5 size-2.5 shrink-0" aria-hidden="true" />
                  {t("managedLab.apiKeyHint")}
                </p>
              </Field>
              <Field label={t("managedLab.model")} htmlFor="managed-lab-model">
                <ModelPicker
                  value={model}
                  options={modelOptions}
                  loading={modelsLoading}
                  error={modelsError}
                  disabled={running}
                  canDiscover={Boolean(baseUrl.trim() && apiKey.trim())}
                  label={t("managedLab.model")}
                  searchPlaceholder={t("managedLab.modelSearch")}
                  emptyLabel={t("managedLab.modelEmpty")}
                  discoveryHint={t("managedLab.modelDiscoveryHint")}
                  customLabel={t("managedLab.modelUseCustom")}
                  onOpen={() => void discoverModels()}
                  onChange={setModel}
                />
              </Field>
              <Field label={t("managedLab.task")} htmlFor="managed-lab-task">
                <Textarea
                  id="managed-lab-task"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  disabled={running}
                  placeholder={t("managedLab.taskPlaceholder")}
                  className="min-h-32 resize-y text-xs leading-5"
                />
              </Field>
            </div>

            {state.error && (
              <StatusNotice tone="danger" className="mt-4">
                {state.error}
              </StatusNotice>
            )}

            <div className="mt-auto flex items-center gap-2 pt-6">
              <Button
                type="submit"
                size="sm"
                disabled={running || !apiKey.trim() || !prompt.trim()}
                loading={running}
                loadingLabel={t(statusKey)}
                className="min-w-36"
              >
                <PlayIcon className="size-3.5" />
                {t("managedLab.run")}
              </Button>
              {running && (
                <Button type="button" variant="outline" size="sm" onClick={() => void stop()}>
                  <SquareIcon className="size-3" />
                  {t("managedLab.stop")}
                </Button>
              )}
            </div>
            <p className="mt-3 text-[9px] leading-4 text-fg-subtle">
              {t("managedLab.cleanup")}
            </p>
          </form>

          <div className="flex min-h-[500px] min-w-0 flex-col overflow-hidden rounded-xl bg-bg-surface/35">
            {state.status === "idle" && protocol.length === 0 ? (
              <div className="grid min-h-[500px] flex-1 place-items-center px-8 text-center">
                <div className="max-w-sm">
                  <span className="mx-auto grid size-9 place-items-center rounded-lg bg-info-subtle text-info">
                    <ActivityIcon className="size-4" aria-hidden="true" />
                  </span>
                  <h2 className="mt-3 text-sm font-medium text-fg">{t("managedLab.emptyTitle")}</h2>
                  <p className="mt-1 text-[11px] leading-5 text-fg-muted">
                    {t("managedLab.emptyDescription")}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <section className="border-b border-border/45 px-5 py-5 sm:px-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xs font-medium text-fg">{t("managedLab.answer")}</h2>
                    {state.result && (
                      <span className="font-mono text-[9px] text-fg-subtle">
                        {state.result.sessionId}
                      </span>
                    )}
                  </div>
                  <div
                    aria-live="polite"
                    className={cn(
                      "mt-3 min-h-20 whitespace-pre-wrap text-[13px] leading-6 text-fg",
                      !state.answer && "text-fg-subtle",
                    )}
                  >
                    {state.answer || (running ? "Waiting for agent output…" : "No text output")}
                  </div>
                </section>

                <section className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center justify-between border-b border-border/35 px-5 py-3 sm:px-6">
                    <h2 className="inline-flex items-center gap-1.5 text-xs font-medium text-fg">
                      <RadioIcon className="size-3.5 text-info" aria-hidden="true" />
                      {t("managedLab.protocol")}
                    </h2>
                    <span className="font-mono text-[9px] text-fg-subtle">
                      {state.http.length} HTTP · {state.sdkEvents.length} SDK
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {protocol.map((item, index) => (
                      <ProtocolRow key={`${item.kind}-${item.at}-${index}`} event={item} />
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ModelPicker({
  value,
  options,
  loading,
  error,
  disabled,
  canDiscover,
  label,
  searchPlaceholder,
  emptyLabel,
  discoveryHint,
  customLabel,
  onOpen,
  onChange,
}: {
  value: string;
  options: ManagedAgentsLabModelOption[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  canDiscover: boolean;
  label: string;
  searchPlaceholder: string;
  emptyLabel: string;
  discoveryHint: string;
  customLabel: string;
  onOpen: () => void;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.id === value);
  const customId = query.trim();
  const exactMatch = options.some((option) => option.id === customId);

  const select = (next: string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen();
        else setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          id="managed-lab-model"
          type="button"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-busy={loading || undefined}
          disabled={disabled}
          className={cn(
            "flex h-8 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-xs outline-none transition-colors",
            "hover:bg-bg-surface/55 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50",
          )}
        >
          <span className="min-w-0 flex-1 truncate font-mono text-fg">{value}</span>
          {selected && selected.displayName !== selected.id && (
            <span className="hidden min-w-0 truncate text-fg-subtle sm:block">
              {selected.displayName}
            </span>
          )}
          {loading
            ? <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-fg-subtle" aria-hidden="true" />
            : <ChevronsUpDownIcon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] gap-0 p-0"
      >
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
          />
          {loading && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-fg-muted" role="status">
              <LoaderCircleIcon className="size-3.5 animate-spin" aria-hidden="true" />
              {discoveryHint}
            </div>
          )}
          {error && (
            <p className="px-3 py-2 text-xs leading-5 text-warning" role="alert">
              {error}
            </p>
          )}
          {!canDiscover && (
            <p className="px-3 py-2 text-xs leading-5 text-fg-muted">
              {discoveryHint}
            </p>
          )}
          <CommandList>
            <CommandEmpty className="px-3 py-5 text-xs text-fg-muted">
              {emptyLabel}
            </CommandEmpty>
            {options.length > 0 && (
              <CommandGroup heading={discoveryHint}>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={`${option.id} ${option.displayName}`}
                    data-checked={option.id === value}
                    onSelect={() => select(option.id)}
                    className="min-h-9"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs text-fg">
                        {option.id}
                      </span>
                      <span className="block truncate text-xs text-fg-subtle">
                        {option.displayName}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {customId && !exactMatch && (
              <CommandGroup>
                <CommandItem
                  value={`${customLabel} ${customId}`}
                  onSelect={() => select(customId)}
                >
                  <CheckIcon className="size-3.5 text-fg-subtle" aria-hidden="true" />
                  <span className="truncate">{customLabel} “{customId}”</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-[10px] font-medium text-fg-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ProtocolRow({ event }: { event: ManagedAgentsLabEvent }) {
  if (event.kind === "http") {
    return (
      <div className="flex min-w-0 items-center gap-3 border-b border-border/30 px-5 py-2.5 font-mono text-[10px] sm:px-6">
        <NetworkIcon className="size-3 shrink-0 text-fg-subtle" aria-hidden="true" />
        <span className="w-8 shrink-0 font-semibold text-info">{event.method}</span>
        <span className="min-w-0 flex-1 truncate text-fg-muted" title={event.path}>{event.path}</span>
        <span className={cn(
          "shrink-0 tabular-nums",
          event.status === 501 ? "text-warning" : event.status && event.status >= 400 ? "text-danger" : "text-success",
        )}>
          {event.status ?? "ERR"}
        </span>
        <span className="w-10 shrink-0 text-right tabular-nums text-fg-subtle">
          {event.durationMs ?? 0}ms
        </span>
      </div>
    );
  }
  if (event.kind !== "sdk_event") return null;
  const preview = sdkEventPreview(event);
  return (
    <details className="group border-b border-border/30">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-2.5 text-[10px] hover:bg-bg-surface/45 sm:px-6">
        <RadioIcon className="size-3 shrink-0 text-info" aria-hidden="true" />
        <span className="w-36 shrink-0 font-mono font-medium text-fg">{event.type}</span>
        <span className="min-w-0 flex-1 truncate text-fg-subtle">{preview}</span>
      </summary>
      <pre className="max-h-48 overflow-auto border-t border-border/25 bg-bg-surface/40 px-6 py-3 font-mono text-[9px] leading-4 text-fg-muted">
        {JSON.stringify(event.data, null, 2)}
      </pre>
    </details>
  );
}

function sdkEventPreview(event: Extract<ManagedAgentsLabEvent, { kind: "sdk_event" }>): string {
  if (event.type === "event_delta") {
    const content = (event.data.delta as { content?: { text?: unknown } } | undefined)?.content;
    if (typeof content?.text === "string") return content.text;
  }
  if (typeof event.data.name === "string") return event.data.name;
  if (typeof event.data.id === "string") return event.data.id;
  return "";
}
