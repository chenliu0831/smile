/**
 * Turns a numeric GFM table inside a report into a chartable shape (ADR-0016). Pure and
 * crash-safe — mirrors lib/leaderboard.ts: malformed agent output (ragged rows, junk cells,
 * blanks) must NEVER throw; junk becomes a null gap, not an exception.
 *
 * The Webview parses the markdown the agent actually produced — there is NO new agent/daemon
 * chart-spec contract (the contract-drift this whole project has been taming). The chart's
 * data is therefore inline, not fetched via /data/{ref} like a DataViz call.
 */

/** A single numeric column: the cleaned header name and one parsed value per row (null = gap). */
export interface NumericColumn {
  name: string;
  values: (number | null)[];
}

/** A report table reduced to "what we can chart": a label column + ≥1 numeric column. */
export interface ChartableTable {
  /** Cleaned name of the (first non-numeric) label column, e.g. "Model" / "Metric". */
  labelName: string;
  /** One label per row (the category axis), in table order. */
  labels: string[];
  /** The numeric columns, in original header order — the picker's options. */
  columns: NumericColumn[];
  /** Index into `columns` of the default column to plot: the first numeric column that
   *  appears AFTER the label column, so a leading index column (e.g. "Cycle") isn't the
   *  default. Falls back to 0 when every numeric column precedes the label. */
  defaultIndex: number;
}

/**
 * Parse one report-table cell into a number, tolerating the decoration real cells carry:
 * markdown bold/italic/inline-code, a leading `+`, `%`, thousands `,`, an `~` approx prefix,
 * and `↑↓→` arrows. Blanks, dashes, ticks, and any residual text return null. The stripped
 * remainder must be a *clean* number — embedded numbers (e.g. "n_estimators=500") return null,
 * so a genuinely textual column is never misread as numeric.
 */
export function parseNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (s === "") return null;
  s = s.replace(/\*\*/g, "").replace(/\*/g, "").replace(/`/g, ""); // markdown emphasis / code
  s = s.replace(/[↑↓→]/g, "").replace(/~/g, "").replace(/%/g, "").replace(/,/g, "").trim();
  if (s.startsWith("+")) s = s.slice(1).trim(); // keep a leading '-', drop a leading '+'
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Clean a header label: drop markdown emphasis/code and trailing sort arrows, then trim. */
function cleanHeader(h: string): string {
  return h.replace(/\*\*/g, "").replace(/`/g, "").replace(/[↑↓→]/g, "").trim();
}

/**
 * A column is numeric if parseable cells form a STRICT MAJORITY of its non-empty cells.
 * Majority (not "any one cell") so a textual label column with a stray numeric-looking entry
 * — a year, a code like "2020" among "Q1"/"Q2" — isn't misclassified as numeric, which would
 * leave the table with no label column and suppress the chart entirely. Empty cells are
 * ignored (not counted against), so a metric column with a few blank/dash gaps stays numeric.
 */
function columnIsNumeric(rows: string[][], col: number): boolean {
  let nonEmpty = 0;
  let parsed = 0;
  for (const r of rows) {
    const cell = (r[col] ?? "").trim();
    if (cell === "") continue;
    nonEmpty++;
    if (parseNumber(cell) !== null) parsed++;
  }
  return nonEmpty > 0 && parsed * 2 > nonEmpty;
}

/**
 * Reduce a GFM table (header cells + body rows, as split by the Markdown renderer) to a
 * ChartableTable, or null when there is nothing to chart: no numeric column (all-text), no
 * label column (all-numeric, e.g. a correlation matrix), or no data rows.
 */
export function tableToChartable(header: string[], rows: string[][]): ChartableTable | null {
  if (rows.length === 0 || header.length === 0) return null;

  const numericFlags = header.map((_, c) => columnIsNumeric(rows, c));
  const labelCol = numericFlags.findIndex((isNum) => !isNum);
  if (labelCol === -1) return null; // every column numeric → no category axis
  const numericCols = header.map((_, c) => c).filter((c) => numericFlags[c]);
  if (numericCols.length === 0) return null; // nothing numeric to plot

  const labels = rows.map((r) => (r[labelCol] ?? "").trim());
  const columns: NumericColumn[] = numericCols.map((c) => ({
    name: cleanHeader(header[c]),
    values: rows.map((r) => parseNumber(r[c])),
  }));

  // Default to the first numeric column positioned after the label (so a leading "Cycle"
  // index column isn't the default); fall back to the first numeric column otherwise.
  const afterLabel = numericCols.findIndex((c) => c > labelCol);
  const defaultIndex = afterLabel === -1 ? 0 : afterLabel;

  return { labelName: cleanHeader(header[labelCol]), labels, columns, defaultIndex };
}
