import { useMemo, useState } from "react";
import { useTree } from "@headless-tree/react";
import { asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature } from "@headless-tree/core";
import { ContextMenu } from "radix-ui";
import { useI18n } from "@/lib/i18n";
import { fileIconUrl, folderIconUrl } from "@/lib/file-icons";
import { ChevronRightIcon, FolderOpenIcon, RefreshCwIcon, ListTreeIcon, CopyIcon } from "@/components/Icons";
import { cn } from "@/lib/utils";

type Entry = { name: string; isDir: boolean; error?: string };

/** The filesystem remains lazy; headless-tree owns recursive expansion,
 * selection, focus, ARIA and keyboard navigation. No nested React row state. */
export function FileTree(props: {
  rootPath: string;
  onRootChange?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  /** File shown in the viewer; seeds the tree selection on mount. */
  selectedPath?: string;
}) {
  // Changing roots resets the data cache as well as selection/expansion.
  return <FileTreeRoot key={props.rootPath} {...props} />;
}

function FileTreeRoot({ rootPath, onRootChange, onOpenFile, selectedPath }: {
  rootPath: string;
  onRootChange?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  selectedPath?: string;
}) {
  const { t } = useI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);
  const rootName = rootPath.replace(/\/$/, "").split("/").pop() || rootPath;
  const cache = useMemo(() => new Map<string, Entry>([[rootPath, { name: rootName, isDir: true }]]), [rootPath, rootName]);
  const tree = useTree<Entry>({
    rootItemId: rootPath,
    // A remount (tab switch) reopens the folders leading to the viewed file.
    initialState: {
      selectedItems: selectedPath ? [selectedPath] : [],
      expandedItems: ancestorsWithin(rootPath, selectedPath),
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isDir,
    onPrimaryAction: (item) => {
      if (!item.isFolder() && !item.getItemData().error) onOpenFile?.(item.getId());
    },
    dataLoader: {
      getItem: (id) => cache.get(id) ?? { name: id.split("/").pop() || id, isDir: false },
      getChildrenWithData: async (path) => {
        try {
          const entries = await window.backchat.uiFsListDir({ path });
          const failures = entries.filter((entry) => entry.error);
          setErrors((previous) => ({ ...previous, [path]: failures.map((entry) => entry.error).join("\n") }));
          return entries.filter((entry) => !entry.error).map((entry) => {
            const id = `${path.replace(/\/$/, "")}/${entry.name}`;
            cache.set(id, entry);
            return { id, data: entry };
          });
        } catch (error) {
          setErrors((previous) => ({ ...previous, [path]: String(error) }));
          return [];
        }
      },
    },
    features: [asyncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([rootPath, ...tree.getState().expandedItems].filter((id, index, all) => all.indexOf(id) === index)
        .map((id) => tree.getItemInstance(id).invalidateChildrenIds()));
    } finally { setRefreshing(false); }
  };
  const light = typeof document !== "undefined" && !document.documentElement.classList.contains("dark");
  const actionClass = "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-[var(--control-bg-hover)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const menuClass = "app-select-item app-select-focus flex items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent";
  const items = tree.getItems();
  const loading = tree.getState().loadingItemChildrens.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col text-xs" data-file-tree="headless-tree">
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-fg-muted hover:text-fg" title={rootPath}
          onClick={async () => {
            const next = await window.backchat.uiFsPickDir({ defaultPath: rootPath });
            if (next && next !== rootPath) onRootChange?.(next);
          }}>
          <FolderOpenIcon className="size-4 shrink-0" /><span className="truncate font-medium">{rootName}</span>
        </button>
        <button type="button" title={t("fileTree.collapseAll")} aria-label={t("fileTree.collapseAll")} className={actionClass} onClick={() => tree.applySubStateUpdate("expandedItems", [])}><ListTreeIcon className="size-3.5" /></button>
        <button type="button" title={t("fileTree.refresh")} aria-label={t("fileTree.refresh")} className={actionClass} disabled={refreshing} onClick={() => void refresh()}><RefreshCwIcon className="size-3.5" /></button>
      </div>
      <div {...tree.getContainerProps(rootName)} className="oma-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3 outline-none">
        {items.map((item) => {
          const data = item.getItemData();
          const path = item.getId();
          const level = item.getItemMeta().level;
          const folder = item.isFolder();
          return (
            <ContextMenu.Root key={item.getKey()}>
              <ContextMenu.Trigger asChild>
                <button {...item.getProps()} type="button" title={path}
                  className={cn("relative flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-fg-muted hover:bg-[var(--control-bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring", item.isSelected() && "bg-[var(--control-bg-hover)] text-fg")}
                  style={{ paddingLeft: level * 16 + 4 }}>
                  {Array.from({ length: level }, (_, i) => <span key={i} aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-border" style={{ left: i * 16 + 11 }} />)}
                  <span className="flex size-3.5 shrink-0 items-center justify-center">{folder && <ChevronRightIcon className={cn("size-3 transition-transform", item.isExpanded() && "rotate-90")} />}</span>
                  <img alt="" draggable={false} className="size-4 shrink-0" src={folder ? folderIconUrl(data.name, item.isExpanded(), light) : fileIconUrl(data.name, light)} />
                  <span className="truncate">{data.name}</span>
                  {item.isLoading() && <span className="ml-auto text-fg-subtle">…</span>}
                </button>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Content className="app-select-content z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-border">
                  {!folder && <ContextMenu.Item className={menuClass} onSelect={() => onOpenFile?.(path)}>{t("fileTree.open")}</ContextMenu.Item>}
                  <ContextMenu.Item className={menuClass} onSelect={() => void window.backchat.uiFsRevealPath({ path })}>{t("fileTree.revealInFinder")}</ContextMenu.Item>
                  <ContextMenu.Item className={menuClass} onSelect={() => void navigator.clipboard.writeText(path)}><CopyIcon className="size-3.5" />{t("fileTree.copyPath")}</ContextMenu.Item>
                  <ContextMenu.Item className={menuClass} onSelect={() => void navigator.clipboard.writeText(path.slice(rootPath.replace(/\/$/, "").length + 1))}>{t("fileTree.copyRelativePath")}</ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
        {Object.entries(errors).filter(([, message]) => message).map(([path, message]) => <p key={path} role="alert" className="px-2 py-2 text-danger" title={path}>{message}</p>)}
        {!items.length && <p className="px-3 py-4 text-fg-subtle">{loading ? t("fileTree.loading") : errors[rootPath] ? null : t("fileTree.empty")}</p>}
      </div>
    </div>
  );
}

function ancestorsWithin(rootPath: string, path: string | undefined): string[] {
  const root = rootPath.replace(/\/$/, "");
  if (!path || !path.startsWith(`${root}/`)) return [];
  const parts = path.slice(root.length + 1).split("/").slice(0, -1);
  return parts.map((_, index) => `${root}/${parts.slice(0, index + 1).join("/")}`);
}
