import { FileIcon } from "lucide-react";
import { toast } from "sonner";
import { FileOpenMenu } from "@/components/shell/FileOpenMenu";

export function ArtifactTab({ path }: { path: string }) {
  const name = basename(path);

  const openDefault = () => {
    void window.backchat.uiFsOpenPath({ path }).then((error) => {
      if (error) throw new Error(error);
    }).catch((error) => {
      toast.error("Couldn't open file", {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/55 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileIcon className="size-4 shrink-0 text-fg-subtle" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-fg" title={name}>
              {name}
            </div>
            <div className="truncate text-[10px] text-fg-subtle" title={path}>
              {path}
            </div>
          </div>
        </div>
        <FileOpenMenu
          path={path}
          onOpenDefault={openDefault}
          onReveal={() => void window.backchat.uiFsRevealPath({ path })}
        />
      </div>

      <div className="flex flex-1 items-center justify-center px-8 text-center">
        <div className="max-w-[280px]">
          <FileIcon className="mx-auto size-9 text-fg-subtle" strokeWidth={1.5} />
          <p className="mt-3 text-sm font-medium text-fg">{name}</p>
          <p className="mt-1 text-xs leading-5 text-fg-muted">
            This format opens in its desktop app.
          </p>
          <button
            type="button"
            onClick={openDefault}
            className="mt-4 inline-flex h-8 items-center rounded-lg bg-fg px-3 text-xs font-medium text-bg transition-opacity hover:opacity-85"
          >
            Open file
          </button>
        </div>
      </div>
    </div>
  );
}

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").pop() || path;
}
