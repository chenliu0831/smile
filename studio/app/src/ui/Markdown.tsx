/**
 * Minimal, dependency-free Markdown renderer for report artifacts — headings, bold,
 * inline code, and list items. Sufficient for the agent's `*_report.md` output in V0.
 */
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

  for (const line of lines) {
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
