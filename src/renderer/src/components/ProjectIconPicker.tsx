import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { ProjectGlyph, projectColors, projectGlyphs, type ProjectIconChoice } from "./ProjectGlyph";
const emojis = ["🚀", "🌍", "🌱", "🌸", "🌈", "🔥", "⭐", "💎", "🎨", "🎵", "🎯", "🧩", "🛠️", "⚡", "🧠", "🐳", "🐙", "🦊", "🐼", "🦋", "🍀", "☕", "🏠", "🏔️"];
export function ProjectIconPicker({ identity, initial, open, onOpenChange, onSave }: {
  identity: string; initial: ProjectIconChoice | null; open: boolean; onOpenChange: (open: boolean) => void; onSave: (choice: ProjectIconChoice | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ProjectIconChoice>(initial ?? { kind: "icon", glyph: "box", color: projectColors[0]! });
  const [tab, setTab] = useState<"icon" | "emoji">(initial?.kind ?? "icon");
  const [search, setSearch] = useState("");
  const [hex, setHex] = useState(initial?.kind === "icon" ? initial.color : projectColors[0]!);
  const setColor = (color: string) => {
    setHex(color);
    if (/^#[0-9a-f]{6}$/i.test(color)) setDraft({ kind: "icon", glyph: draft.kind === "icon" ? draft.glyph : "box", color });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm" showCloseButton>
      <DialogHeader><DialogTitle>{t("project.iconTitle")}</DialogTitle><DialogDescription>{t("project.iconDescription")}</DialogDescription></DialogHeader>
      <div className="flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center p-1.5"><ProjectGlyph identity={identity} choice={draft} /></span>
        <div className="flex gap-1" role="tablist" aria-label={t("project.iconTitle")}>
          <Button role="tab" aria-selected={tab === "icon"} variant={tab === "icon" ? "secondary" : "ghost"} onClick={() => setTab("icon")}>{t("project.icons")}</Button>
          <Button role="tab" aria-selected={tab === "emoji"} variant={tab === "emoji" ? "secondary" : "ghost"} onClick={() => setTab("emoji")}>Emoji</Button>
        </div>
      </div>
      {tab === "icon" ? <>
        <div className="flex items-center gap-2">
          {projectColors.map(color => <button key={color} type="button" aria-label={color} aria-pressed={draft.kind === "icon" && draft.color === color} onClick={() => setColor(color)} className="size-5 shrink-0 rounded-full border-2 border-transparent aria-pressed:border-fg outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" style={{ backgroundColor: color }} />)}
          <input type="color" aria-label={t("project.iconColor")} value={draft.kind === "icon" ? draft.color : projectColors[0]} onChange={e => setColor(e.target.value)} className="size-7 cursor-pointer border-0 bg-transparent p-0" />
        </div>
        <input aria-label={t("project.iconHex")} value={hex} maxLength={7} onChange={e => setColor(e.target.value)} className="h-8 rounded-md border border-border bg-transparent px-2 font-mono text-ui" />
        <input aria-label={t("project.searchIcons")} placeholder={t("project.searchIcons")} value={search} onChange={e => setSearch(e.target.value)} className="h-8 rounded-md border border-border bg-transparent px-2 text-ui" />
        <div className="grid max-h-52 grid-cols-8 gap-1 overflow-y-auto" role="group" aria-label={t("project.icons")}>
          {projectGlyphs.filter(([name, zh]) => `${name} ${zh}`.includes(search.toLowerCase().trim())).map(([name, zh, Glyph]) => <button key={name} type="button" aria-label={`${name} · ${zh}`} title={`${name} · ${zh}`} aria-pressed={draft.kind === "icon" && draft.glyph === name} onClick={() => setDraft({ kind: "icon", glyph: name, color: /^#[0-9a-f]{6}$/i.test(hex) ? hex : projectColors[0]! })} className="flex size-8 items-center justify-center rounded-md hover:bg-surface-hover aria-pressed:bg-surface-hover aria-pressed:ring-1 aria-pressed:ring-ring focus-visible:outline-2 focus-visible:outline-ring"><Glyph weight="fill" className="size-5" style={{ color: draft.kind === "icon" ? draft.color : projectColors[0] }} /></button>)}
        </div>
      </> : <div className="grid grid-cols-8 gap-1" role="group" aria-label={t("project.emoji")}>
        {emojis.map(emoji => <button key={emoji} type="button" aria-label={emoji} aria-pressed={draft.kind === "emoji" && draft.emoji === emoji} onClick={() => setDraft({ kind: "emoji", emoji })} className="flex size-8 items-center justify-center rounded-md text-xl hover:bg-surface-hover aria-pressed:bg-surface-hover aria-pressed:ring-1 aria-pressed:ring-ring">{emoji}</button>)}
      </div>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => onSave(null)}>{t("project.automaticIcon")}</Button>
        <Button onClick={() => onSave(draft)} disabled={tab === "icon" && !/^#[0-9a-f]{6}$/i.test(hex)}>{t("common.save")}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
