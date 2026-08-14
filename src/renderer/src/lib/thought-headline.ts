export function thoughtHeadline(text: string): string {
  let headline = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    const bold = trimmed.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/)?.[1];
    if (heading || bold) headline = (heading ?? bold)!.trim();
  }
  return headline;
}
