/** Session titles come from a prompt or from the agent, so they can carry
 *  markdown: a first message of `[#65](https://github.com/openma-ai/backchat/issues/65)`
 *  titles the chat with the whole link syntax.
 *
 *  The sidebar row, the hover card and the topbar show one short label. There
 *  the syntax is noise and the words are the title, so the label reads as
 *  `#65` instead of the link the user typed.
 *
 *  This is a readability helper, not a markdown parser: it handles what a
 *  title realistically holds — links, images, inline code, emphasis,
 *  headings, quotes, list markers and inline HTML — and leaves everything
 *  else alone. */
export function markdownToPlainText(markdown: string): string {
  if (!markdown) return "";
  const plain = stripMarkdown(markdown);
  // A title made of nothing but markup (an image, a rule) still has to read
  // as something: fall back to the raw text rather than an empty label.
  return plain || markdown.trim();
}

function stripMarkdown(markdown: string): string {
  return markdown
    // Fenced code keeps its content; only the fence markers go.
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*$/gm, "")
    // Horizontal rules are decoration, never a title.
    .replace(/^[ \t]{0,3}([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
    // Block prefixes: headings, quotes, list markers.
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "")
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
    // Inline code.
    .replace(/`+([^`]*)`+/g, "$1")
    // Images and inline links: keep the words, drop the target.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Reference links.
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    // Autolinks.
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    // Inline HTML.
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    // Strong, emphasis and strikethrough.
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w_])__([^_]+)__(?![\w_])/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\s][^_]*?)_(?![\w_])/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    // One label, one line.
    .replace(/\s+/g, " ")
    .trim();
}
