import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  showBoundaries = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  showBoundaries?: boolean
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const [boundaries, setBoundaries] = React.useState({ top: false, bottom: false })

  const updateBoundaries = React.useCallback(() => {
    if (!showBoundaries) return
    const viewport = viewportRef.current
    if (!viewport) return
    const epsilon = 1
    const next = {
      top: viewport.scrollTop > epsilon,
      bottom:
        viewport.scrollTop + viewport.clientHeight
        < viewport.scrollHeight - epsilon,
    }
    setBoundaries((current) =>
      current.top === next.top && current.bottom === next.bottom
        ? current
        : next
    )
  }, [showBoundaries])

  React.useEffect(() => {
    if (!showBoundaries) return
    const viewport = viewportRef.current
    if (!viewport) return
    const frame = requestAnimationFrame(updateBoundaries)
    const resizeObserver = new ResizeObserver(updateBoundaries)
    resizeObserver.observe(viewport)
    const content = viewport.firstElementChild
    if (content instanceof HTMLElement) resizeObserver.observe(content)
    const mutationObserver = new MutationObserver(updateBoundaries)
    mutationObserver.observe(viewport, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [showBoundaries, updateBoundaries])

  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1"
        onScroll={updateBoundaries}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {showBoundaries && (
        <>
          <span
            aria-hidden="true"
            data-sidebar-scroll-boundary="top"
            data-visible={boundaries.top ? "true" : "false"}
            className="sidebar-scroll-boundary sidebar-scroll-boundary-top"
          />
          <span
            aria-hidden="true"
            data-sidebar-scroll-boundary="bottom"
            data-visible={boundaries.bottom ? "true" : "false"}
            className="sidebar-scroll-boundary sidebar-scroll-boundary-bottom"
          />
        </>
      )}
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none data-horizontal:h-2.5 data-horizontal:flex-col data-horizontal:border-t data-horizontal:border-t-transparent data-vertical:h-full data-vertical:w-2.5 data-vertical:border-l data-vertical:border-l-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
