/**
 * Pure parser for the report's "Recommended Next Steps" (S8, ADR-0006).
 *
 * The automl skill's `automl_report.md` ends with a `## Recommended Next Steps` section
 * (numbered/bulleted actions). This extracts those items so the UI can render them as
 * one-click steering buttons. React-free, dependency-free, unit-tested directly.
 */

/** Heading variants the skill (or close paraphrases) may use for the section. */
const HEADING = /^#{1,6}\s*(recommended\s+next\s+steps|next\s+steps)\s*$/i;

/** Strip a leading list marker ("1.", "-", "*", "•") and surrounding markdown emphasis. */
function cleanItem(line: string): string {
  return line
    .replace(/^\s*(?:\d+[.)]|[-*•])\s+/, "") // list marker
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/`(.+?)`/g, "$1") // inline code
    .trim();
}

/**
 * Extract the "Recommended Next Steps" items from a report's markdown. Reads the lines under
 * the matching heading until the next heading or end. Returns [] when the section is absent
 * or empty. Caps at 8 items so a runaway list can't flood the UI.
 */
export function parseNextSteps(markdown: string | undefined | null): string[] {
  if (!markdown) return [];
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (HEADING.test(line.trim())) { inSection = true; continue; }
    if (!inSection) continue;
    if (/^#{1,6}\s+/.test(line.trim())) break; // next heading ends the section
    const isItem = /^\s*(?:\d+[.)]|[-*•])\s+/.test(line);
    if (!isItem) continue;
    const item = cleanItem(line);
    if (item) out.push(item);
    if (out.length >= 8) break;
  }
  return out;
}
