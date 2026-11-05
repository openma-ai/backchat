SECONDARY UX (do not revert; no business-logic change). PRIMARY remains CPU/MEM/SPEED ~50%.
1) Sidebar search: empty penultimate + last in double trailing; CSS grid-column 2/-1.
2) SettingsLayout 「返回应用」: w-fit → w-full so hover/selected wash fills chrome row.
3) ChatView bound empty: show ProjectIcon (project-empty-state) instead of null.
4) WorkspaceGroupHeading caret: icon cell is a disclosure button with onToggle (was inert span).
