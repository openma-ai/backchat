import { useState, type ReactElement, type ReactNode, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLinkIcon, GitBranchIcon, GitPullRequestIcon } from "@/components/Icons";
import { MoreIcon as MoreHorizontalIcon } from "@/components/BackchatIcons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { GAP_ADJACENT_PX } from "@/components/ui/gap-adjacent";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { repositoryWebLink } from "@shared/repository-web";
import { gitUpstreamQuery } from "./RepositoryHoverCard";

/** One sidebar row, one menu. The ⋯ button and right-click render the same
 *  definition through a kit, so the two can never drift apart (they used to
 *  be written twice, with different classes, and only chats had right-click).
 *
 *  Kit components are thin over Radix: DropdownMenu.Item does not render
 *  inside ContextMenu and vice versa, so each surface supplies its own. */

export type MenuItemProps = {
  onSelect: () => void;
  icon?: ReactNode;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
};

export type MenuKit = {
  Item: (props: MenuItemProps) => ReactNode;
  Sub: (props: { label: ReactNode; icon?: ReactNode; children: ReactNode }) => ReactNode;
  Separator: () => ReactNode;
};

export type RowMenu = (kit: MenuKit) => ReactNode;

const ITEM_CLASS = "flex items-center gap-2 py-1 text-ui";
const icon = (node: ReactNode) => node ? <span className="inline-flex size-3.5 [&>svg]:size-3.5">{node}</span> : null;

const dropdownKit: MenuKit = {
  Item: ({ onSelect, icon: glyph, children, danger, disabled }) => (
    <DropdownMenuItem onSelect={onSelect} disabled={disabled} variant={danger ? "destructive" : "default"} className={ITEM_CLASS}>
      {icon(glyph)}<span>{children}</span>
    </DropdownMenuItem>
  ),
  Sub: ({ label, icon: glyph, children }) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={ITEM_CLASS}>{icon(glyph)}<span className="flex-1">{label}</span></DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-36">{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  ),
  Separator: () => <DropdownMenuSeparator className="my-1 h-px bg-border/60" />,
};

const contextKit: MenuKit = {
  Item: ({ onSelect, icon: glyph, children, danger, disabled }) => (
    <ContextMenuItem onSelect={onSelect} disabled={disabled} variant={danger ? "destructive" : "default"} className={ITEM_CLASS}>
      {icon(glyph)}<span>{children}</span>
    </ContextMenuItem>
  ),
  Sub: ({ label, icon: glyph, children }) => (
    <ContextMenuSub>
      <ContextMenuSubTrigger className={ITEM_CLASS}>{icon(glyph)}<span className="flex-1">{label}</span></ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-36">{children}</ContextMenuSubContent>
    </ContextMenuSub>
  ),
  Separator: () => <ContextMenuSeparator className="my-1 h-px bg-border/60" />,
};

/** Right-click anywhere on the row opens its menu. While open, Radix marks
 *  the row data-state="open", which the row CSS treats like a held ⋯ menu. */
export function RowContextMenu({ menu, children }: { menu: RowMenu; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu modal={false} onOpenChange={setOpen}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {open && (
        <ContextMenuContent className="w-fit min-w-[var(--menu-context-min-width)]">
          {menu(contextKit)}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

/** The row's ⋯ button: same menu, anchored to the button. */
export function RowMoreMenu({
  menu,
  open,
  onOpenChange,
  label,
  className,
  buttonRef,
}: {
  menu: RowMenu;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  className?: string;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          ref={buttonRef}
          type="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          data-sidebar-row-action="true"
          data-sidebar-grid-action="last"
          className={cn("sidebar-row-action", className)}
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      {open && (
        <DropdownMenuContent align="end" sideOffset={GAP_ADJACENT_PX} className="w-fit min-w-[var(--menu-context-min-width)]">
          {menu(dropdownKit)}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

function copyText(value: string, done: string, failed: string) {
  navigator.clipboard.writeText(value).then(
    () => toast.success(done),
    () => toast.error(failed),
  );
}

const PROVIDER_LABEL = { github: "GitHub", gitlab: "GitLab" } as const;
const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** Where a checkout lives online and how to grab its identity: repository,
 *  branch, the branch's PR / MR list, and copy path / branch. Links are built
 *  from the local remote — no gh / glab lookup, so nothing loads in the menu.
 *  One checkout lists its items inline; several get one submenu each. */
export function RepositoryMenuItems({ kit, paths }: { kit: MenuKit; paths: string[] }) {
  const { t } = useI18n();
  const roots = [...new Set(paths.filter(Boolean))];
  const upstream = useQuery({ ...gitUpstreamQuery(roots), enabled: roots.length > 0 });
  if (roots.length === 0) return null;
  const checkout = (path: string, index: number) => {
    const git = upstream.data?.[index];
    const link = repositoryWebLink(git?.remote, git?.branch);
    const kind = link?.provider === "gitlab" ? "MR" : "PR";
    return (
      <>
        {link && (
          <kit.Item icon={<ExternalLinkIcon />} onSelect={() => window.open(link.url, "_blank")}>
            {t("repoMenu.openRepository", { provider: PROVIDER_LABEL[link.provider] })}
          </kit.Item>
        )}
        {link?.branchUrl && (
          <kit.Item icon={<GitBranchIcon />} onSelect={() => window.open(link.branchUrl!, "_blank")}>
            {t("repoMenu.openBranch")}
          </kit.Item>
        )}
        {link?.reviewsUrl && (
          <kit.Item icon={<GitPullRequestIcon />} onSelect={() => window.open(link.reviewsUrl!, "_blank")}>
            {t("repoMenu.branchReviews", { kind })}
          </kit.Item>
        )}
        <kit.Item onSelect={() => copyText(path, t("repoMenu.pathCopied"), t("sidebar.copyFailed"))}>
          {t("repoMenu.copyPath")}
        </kit.Item>
        {git?.branch && (
          <kit.Item onSelect={() => copyText(git.branch!, t("repoMenu.branchCopied"), t("sidebar.copyFailed"))}>
            {t("repoMenu.copyBranch")}
          </kit.Item>
        )}
      </>
    );
  };
  return (
    <>
      <kit.Separator />
      {roots.length === 1
        ? checkout(roots[0]!, 0)
        : roots.map((path, index) => (
          <kit.Sub key={path} icon={<GitBranchIcon />} label={basename(path)}>
            {checkout(path, index)}
          </kit.Sub>
        ))}
    </>
  );
}
