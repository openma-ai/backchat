import { useCallback, useEffect, useState, type KeyboardEvent } from "react";

/** Suppress cmdk's initial data-selected wash until the user arrows or hovers. */
export function useGroupedCommandRovingHighlight(resetKey?: string) {
  const [rovingActive, setRovingActive] = useState(false);

  useEffect(() => {
    setRovingActive(false);
  }, [resetKey]);

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      setRovingActive(true);
    }
  }, []);

  return {
    rovingActive,
    onKeyDown,
    commandRovingProps: {
      "data-roving-active": rovingActive ? "true" : "false",
      onKeyDown,
    } as const,
  };
}
