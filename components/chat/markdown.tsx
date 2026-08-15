"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Answers arrive as Markdown. Rendering it as pre-wrapped text was the reason
 * the chat looked bad — headings, bullets, tables and bold all showed as raw
 * syntax. Styling lives in .md-body in globals.css.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Model-supplied links go to the open web — never let one navigate
          // the app frame, and don't leak the referrer.
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
