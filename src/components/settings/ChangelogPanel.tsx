import { Fragment, type ReactNode } from "react";
import changelog from "@/../CHANGELOG.md?raw";

const releases = changelog
  .split(/^## /m)
  .slice(1)
  .map((release) => {
    const [title = "", ...lines] = release.trim().split("\n");
    return { title, lines };
  });

function linkedText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const links = /\[([^\]]+)\]\((https:\/\/[^)]+)\)/g;
  let start = 0;
  for (const match of text.matchAll(links)) {
    nodes.push(text.slice(start, match.index));
    nodes.push(
      <a
        key={match.index}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {match[1]}
      </a>,
    );
    start = match.index + match[0].length;
  }
  nodes.push(text.slice(start));
  return nodes;
}

export function ChangelogPanel() {
  return (
    <section className="max-w-3xl space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Changelog</h2>
        <p className="text-sm text-muted-foreground">
          Release notes included with this version of ManaBrew, newest first.
        </p>
      </header>
      {releases.map(({ title, lines }, index) => (
        <details key={title} open={index === 0} className="rounded-lg border bg-card/40 p-4">
          <summary className="cursor-pointer font-medium">{linkedText(title)}</summary>
          <div className="mt-4 space-y-2 break-words text-sm">
            {lines
              .filter((line) => line.trim())
              .map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {line.startsWith("### ") ? (
                    <h3 className="pt-2 font-semibold">{linkedText(line.slice(4))}</h3>
                  ) : /^[-*] /.test(line) ? (
                    <p className="pl-4 -indent-4">• {linkedText(line.slice(2))}</p>
                  ) : (
                    <p>{linkedText(line)}</p>
                  )}
                </Fragment>
              ))}
          </div>
        </details>
      ))}
    </section>
  );
}
