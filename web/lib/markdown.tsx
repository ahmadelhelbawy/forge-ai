/**
 * Tiny markdown renderer for chat messages (no dependency).
 *
 * Supports fenced code blocks, headings, bold, inline code, and bulleted
 * lists. Everything else renders as paragraphs. Deliberately small: chat
 * replies are discussion, not documents.
 */
import React from "react";

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[12.5px] text-accent-400">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        code.push(lines[i] ?? "");
        i++;
      }
      i++;
      blocks.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-[12.5px] leading-relaxed">
          {lang ? <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{lang}</div> : null}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const content = line.replace(/^#+\s*/, "");
      const cls = level === 1 ? "text-base font-semibold" : "text-sm font-semibold";
      blocks.push(<div key={key++} className={`${cls} mb-1 mt-3 text-slate-100`}>{inline(content, `h${key}`)}</div>);
      i++;
      continue;
    }
    if (/^(\s*[-*]\s+)/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^(\s*[-*]\s+)/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^(\s*[-*]\s+)/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="mb-2 list-disc space-y-1 pl-5 leading-relaxed">
          {items.map((item, j) => (
            <li key={j}>{inline(item, `li${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !(lines[i] ?? "").startsWith("```")) {
      para.push(lines[i] ?? "");
      i++;
    }
    blocks.push(<p key={key++} className="mb-2 leading-relaxed">{inline(para.join(" "), `p${key}`)}</p>);
  }
  return <div className="prose-forge text-[13.5px] text-slate-300">{blocks}</div>;
}
