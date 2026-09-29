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
    <aside aria-label="Conversations" className="flex h-full w-full flex-col border-r border-white/[0.06] bg-ink-900/90">
      <div className="px-3 pb-2 pt-3">
        <button
          onClick={onNew}
          data-testid="new-conversation"
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-ink-850 px-3 text-[13px] font-medium text-slate-100 transition-colors hover:border-white/[0.16] hover:bg-ink-800"
        >
          <Plus size={15} />
          New conversation
        </button>
      </div>
      <div className="px-4 pb-1 pt-2 text-[11.5px] font-medium text-slate-500">Recent</div>
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
              data-testid={`conversation-${c.id}`}
              onClick={() => onSelect(c.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(c.id);
                }
              }}
              aria-current={c.id === activeId ? "true" : undefined}
              className={`group relative mb-0.5 cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                c.id === activeId ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
              }`}
            >
              <div className="flex items-start gap-2">
                <MessageSquare size={14} className={`mt-0.5 shrink-0 ${c.id === activeId ? "text-accent-300" : "text-slate-600"}`} />
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[13px] ${c.id === activeId ? "text-slate-50" : "text-slate-300"}`}>{c.title}</div>
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
                  aria-label={`Delete ${c.title}`}
                  className="shrink-0 rounded p-1 text-slate-500 opacity-0 transition-opacity hover:bg-white/[0.08] hover:text-slate-200 focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-white/[0.06] px-4 py-2 text-[11px] text-slate-600">
        Stored locally on this machine. FORGE never runs agents.
      </div>
    </aside>
  );
}
