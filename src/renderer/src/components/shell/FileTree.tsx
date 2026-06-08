import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRightIcon,
  ChevronDownIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * FileTree — single-cwd lazy-expand file browser shown in a side
 * panel tab. Reads directory entries via the UiFsListDir IPC; clicking
 * a folder toggles its expanded state and fetches children on first
 * expand. No preview / no double-click open in v1.
 *
 * Performance: each directory is fetched once per expand cycle and
 * cached in component state. Re-collapse keeps the cache so re-expand
 * is instant; future PR can invalidate on FS watcher events.
 *
 * Root change: the cwd label is a button that opens the native
 * "Choose folder" picker (Electron dialog.showOpenDialog). The new
 * path is bubbled up via `onRootChange` so the side panel can patch
 * the tab payload — a remount with a new `rootPath` flushes the
 * cached children.
 */
export function FileTree({
  rootPath,
  onRootChange,
}: {
  rootPath: string;
  onRootChange?: (path: string) => void;
}) {
  const onPickRoot = useCallback(async () => {
    const next = await window.backchat.uiFsPickDir({ defaultPath: rootPath });
    if (next && next !== rootPath) onRootChange?.(next);
  }, [rootPath, onRootChange]);

  return (
    <div className="flex h-full min-h-0 flex-col text-xs">
      <button
        type="button"
        onClick={onPickRoot}
        className={cn(
          "shrink-0 flex items-center gap-1.5 px-3 pt-3 pb-2",
          "font-mono text-[11px] text-fg-subtle hover:text-fg",
          "transition-colors",
          "text-left",
        )}
        title="Choose folder"
      >
        <FolderOpenIcon className="size-3.5 shrink-0" />
        <span className="truncate">{rootPath}</span>
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
        <DirNode key={rootPath} path={rootPath} depth={0} initiallyExpanded />
      </div>
    </div>
  );
}

type Entry = { name: string; isDir: boolean; error?: string };

/** Recursive node. `initiallyExpanded` is true only for the root —
 *  every nested folder starts collapsed so the user opens the tree
 *  level by level. */
function DirNode({
  path,
  depth,
  initiallyExpanded = false,
}: {
  path: string;
  depth: number;
  initiallyExpanded?: boolean;
}) {
  const [expanded] = useState(initiallyExpanded);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch on first expand. Re-collapse keeps the cache; re-expand
  // reuses it. No refresh button in v1 — close the tab + reopen if
  // contents changed on disk.
  useEffect(() => {
    if (!expanded || entries !== null) return;
    setLoading(true);
    void window.backchat
      .uiFsListDir({ path })
      .then((rows) => {
        setEntries(rows);
        setLoading(false);
      })
      .catch((e) => {
        setEntries([{ name: `<${String(e)}>`, isDir: false, error: String(e) }]);
        setLoading(false);
      });
  }, [expanded, entries, path]);

  return (
    <>
      {entries === null && !expanded ? null : (
        <ul>
          {(entries ?? []).map((entry) => (
            <FsRow
              key={entry.name}
              path={path}
              entry={entry}
              depth={depth}
            />
          ))}
          {loading && (
            <li
              className="px-2 py-0.5 text-fg-subtle"
              style={{ paddingLeft: `${depth * 12 + 24}px` }}
            >
              Loading…
            </li>
          )}
        </ul>
      )}
    </>
  );
}

function FsRow({
  path,
  entry,
  depth,
}: {
  path: string;
  entry: Entry;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const childPath = useMemo(
    () => (path.endsWith("/") ? path + entry.name : path + "/" + entry.name),
    [path, entry.name],
  );
  const onClick = useCallback(() => {
    if (entry.isDir) setExpanded((v) => !v);
  }, [entry.isDir]);

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left",
          "hover:bg-bg-surface/60",
          entry.error && "text-fg-subtle italic",
          "transition-colors",
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        title={entry.error ?? childPath}
      >
        <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-fg-subtle">
          {entry.isDir ? (
            expanded ? (
              <ChevronDownIcon className="size-3.5" />
            ) : (
              <ChevronRightIcon className="size-3.5" />
            )
          ) : null}
        </span>
        {entry.isDir ? (
          <FolderIcon className="size-3.5 shrink-0 text-fg-subtle" />
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-fg-subtle" />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.isDir && expanded && (
        <DirNode path={childPath} depth={depth + 1} />
      )}
    </li>
  );
}
