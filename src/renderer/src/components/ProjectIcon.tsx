import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ProjectGlyph, useProjectIcon } from "./ProjectGlyph";

/** Shared project identity in navigation, pickers and settings.
 *
 *  One mark per project, in order of intent: the icon or emoji the user
 *  chose, then the repository's own GitHub artwork (custom social image,
 *  else the owner avatar; see main/repository-image.ts), then a letter tile
 *  from the name. A multi-root project no longer stacks one mark per
 *  source folder; the primary folder's repository speaks for it. */
export function ProjectIcon({ identity, name, sourceFolders, primaryRoot, className }: {
  identity: string;
  /** Display name for the letter tile; defaults to the primary folder name. */
  name?: string;
  sourceFolders: string[];
  primaryRoot: string;
  className?: string;
}) {
  const iconChoice = useProjectIcon(identity);
  const root = primaryRoot || sourceFolders[0] || "";
  const fallbackName = (root || identity).split("/").filter(Boolean).pop();
  const image = useQuery({
    queryKey: ["repository-image", root],
    queryFn: () => window.backchat.uiFsRepositoryImage({ path: root }),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    enabled: !iconChoice && !!root,
  });
  const src = iconChoice ? null : image.data ?? null;
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = !!src && failed !== src;
  return (
    <span className={cn("relative inline-flex size-4 shrink-0 items-center justify-center", className)} aria-hidden="true">
      {showImage ? (
        <img
          src={src}
          alt=""
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
          className="project-image"
          onError={() => setFailed(src)}
        />
      ) : (
        <ProjectGlyph identity={identity} name={name || fallbackName} choice={iconChoice} />
      )}
    </span>
  );
}
