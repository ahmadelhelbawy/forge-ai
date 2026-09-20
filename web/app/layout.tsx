import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "FORGE — Prompt Workspace",
  description: "A conversational workspace for creating and iterating prompts for AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className="dark">
      <body className="bg-ink-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}
