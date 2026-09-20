"use client";

import { MessageSquare, Plus, Trash2 } from "lucide-react";

import type { ConversationSummary } from "@/lib/api";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete }: Props): React.JSX.Element {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
      <div className="flex items-center gap-2 px-4 pb-3 pt-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-500 font-mono text-sm font-bold text-white">
          F
        </div>
        <div className="text-sm font-semibold tracking-wide text-slate-100">FORGE</div>
      </div>
      <div className="px-3 pb-2">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-[13px] font-medium text-slate-200 transition-colors hover:border-ink-600 hover:bg-ink-700"
        >
          <Plus size={15} />
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs leading-relaxed text-slate-500">
            No conversations yet.
            <br />
            Start one to shape your first prompt.
          </div>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelect(c.id);
              }}
              className={`group mb-1 cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                c.id === activeId ? "bg-ink-700" : "hover:bg-ink-850"
              }`}
            >
              <div className="flex items-start gap-2">
                <MessageSquare size={14} className="mt-0.5 shrink-0 text-slate-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-slate-200">{c.title}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {timeAgo(c.updatedAt)} · {c.messageCount} msg{c.messageCount === 1 ? "" : "s"}
                    {c.hasPrompt ? ` · v${c.currentV}` : ""}
                  </div>
                </div>
                <button
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  className="hidden shrink-0 rounded p-1 text-slate-500 hover:bg-ink-600 hover:text-slate-200 group-hover:block"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-ink-800 px-4 py-2 text-[11px] text-slate-600">
        Conversations persist on this server.
      </div>
    </aside>
  );
}
