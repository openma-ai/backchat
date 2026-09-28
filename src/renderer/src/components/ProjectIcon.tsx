import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { ProjectGlyph, useProjectIcon } from "./ProjectGlyph";

/** Shared project identity in navigation, pickers and settings. */
export function ProjectIcon({ identity, sourceFolders, primaryRoot, className }: {
  identity: string; sourceFolders: string[]; primaryRoot: string; className?: string;
}) {
  const iconChoice = useProjectIcon(identity);
  const paths = sourceFolders.length ? sourceFolders : [primaryRoot].filter(Boolean);
  const images = useQueries({ queries: paths.slice(0, 2).map(path => ({
    queryKey: ["repository-image", path],
    queryFn: () => window.backchat.uiFsRepositoryImage({ path }),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    enabled: !iconChoice,
  })) });
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [transparentImages, setTransparentImages] = useState<Set<string>>(() => new Set());
  const icons = iconChoice ? [null] : images.length ? images.map(image => image.data ?? null) : [null];
  return (
        <span className={cn("relative inline-flex size-4 shrink-0 items-center justify-center", className)} aria-hidden="true">
          {icons.map((src, index) => <span key={index} className={cn(
            "relative inline-flex size-full items-center justify-center",
            icons.length > 1 && "absolute !size-3",
            icons.length > 1 && (index === 0 ? "-left-0.5 -top-0.5" : "left-1 top-1"),
          )}>
            {(!src || failedImages.has(src) || !transparentImages.has(src)) && <ProjectGlyph identity={paths[index] ?? identity} choice={iconChoice} />}
            {src && !failedImages.has(src) && <img
              src={src} alt="" crossOrigin="anonymous" referrerPolicy="no-referrer"
              className={cn("absolute inset-0 size-full object-contain", !transparentImages.has(src) && "opacity-0")}
              onLoad={event => {
                try {
                  const img = event.currentTarget;
                  const canvas = document.createElement("canvas");
                  canvas.width = 64; canvas.height = 64;
                  const context = canvas.getContext("2d", { willReadFrequently: true });
                  if (!context) throw new Error("Canvas unavailable");
                  context.drawImage(img, 0, 0, 64, 64);
                  const pixels = context.getImageData(0, 0, 64, 64).data;
                  let transparent = 0;
                  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! < 128) transparent++;
                  if (transparent >= 64 * 64 * 0.05) setTransparentImages(previous => new Set(previous).add(src));
                  else setFailedImages(previous => new Set(previous).add(src));
                } catch { setFailedImages(previous => new Set(previous).add(src)); }
              }}
              onError={() => setFailedImages(previous => new Set(previous).add(src))}
            />}
          </span>)}
        </span>
  );
}
