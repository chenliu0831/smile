/**
 * Minimal, dependency-free Markdown renderer for report artifacts — headings, bold,
 * inline code, list items, GFM tables, and fenced code blocks. The tables + code blocks
 * matter for the agent's EDA/summary output: `describe()` stats and correlation matrices
 * are emitted as GFM tables or aligned code, which previously degraded to flat paragraphs.
 *
 * Numeric tables also get an inline Report Chart rendered directly below them (ADR-0016) —
 * the structured header+rows we already split for the <table> are handed to lib/reportCharts.
 */
import { tableToChartable } from "../lib/reportCharts";
import { ReportTableChart } from "./ReportTableChart";
function renderInline(text: string): (string | JSX.Element)[] {
  const out: (string | JSX.Element)[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else out.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A GFM table row: split on unescaped pipes, trimming the outer empties. */
function splitRow(line: string): string[] {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  return cells;
}
function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const blocks: JSX.Element[] = [];
  let list: string[] = [];
  let key = 0;

  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={key++}>{list.map((li, i) => <li key={i}>{renderInline(li)}</li>)}</ul>,
      );
      list = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block: ``` … ``` — preserve alignment (describe()/corr matrices).
    if (/^\s*```/.test(line)) {
      flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      blocks.push(<pre key={key++} className="md-code">{buf.join("\n")}</pre>);
      continue;
    }

    // GFM table: a header row followed by a |---|---| separator.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      const header = splitRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--; // the for-loop will i++ past the last consumed row
      blocks.push(
        <table key={key++} className="md-table">
          <thead><tr>{header.map((h, hi) => <th key={hi}>{renderInline(h)}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      // Chart the table in place when it's numeric (a label column + ≥1 numeric column).
      // tableToChartable is crash-safe and returns null when there's nothing to chart.
      const chartable = tableToChartable(header, rows);
      if (chartable) blocks.push(<ReportTableChart key={key++} chartable={chartable} />);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    flushList();
    if (line.startsWith("### ")) blocks.push(<h3 key={key++}>{renderInline(line.slice(4))}</h3>);
    else if (line.startsWith("## ")) blocks.push(<h2 key={key++}>{renderInline(line.slice(3))}</h2>);
    else if (line.startsWith("# ")) blocks.push(<h1 key={key++}>{renderInline(line.slice(2))}</h1>);
    else if (line.trim() === "") { /* skip blank */ }
    else blocks.push(<p key={key++}>{renderInline(line)}</p>);
  }
  flushList();

  return <div className="report">{blocks}</div>;
}
