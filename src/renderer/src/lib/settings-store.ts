import { useEffect, useState } from "react";
import type { Settings } from "@shared/settings.js";

/**
 * Settings store hook — reads + subscribes to the main-process settings via
 * IPC. Renderer never owns settings state directly; main is the source of
 * truth (it writes to ~/.openma-desktop/config.toml). The hook caches the
 * most recent snapshot in module scope so multiple consumers don't trigger
 * redundant `settings:get` round-trips on mount.
 */

let _cached: Settings | null = null;
let _ipcWiredUp = false;
const _listeners = new Set<(s: Settings) => void>();

function notify(s: Settings) {
  _cached = s;
  for (const l of _listeners) l(s);
}

async function ensureSubscribed(): Promise<void> {
  if (_ipcWiredUp) return;
  _ipcWiredUp = true;
  window.openma.onSettingsChanged((s) => notify(s));
  const initial = await window.openma.settingsGet();
  notify(initial);
}

export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(_cached);
  useEffect(() => {
    let mounted = true;
    void ensureSubscribed();
    const l = (next: Settings) => {
      if (mounted) setS(next);
    };
    _listeners.add(l);
    if (_cached) setS(_cached);
    return () => {
      mounted = false;
      _listeners.delete(l);
    };
  }, []);
  return s;
}

/** Imperative read used by call sites that don't have a hook in scope (e.g.
 *  click handlers that need the latest defaults to seed a new draft). Falls
 *  back to null when not loaded yet — caller decides how to handle. */
export function getSettings(): Settings | null {
  return _cached;
}

export async function patchSettings(partial: Partial<Settings>): Promise<void> {
  await window.openma.settingsPatch(partial);
}
