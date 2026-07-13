import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../hooks/useChat';

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  selfUserId: string;
  /** Collapsible overlay (match) vs always-open sidebar (lobby). */
  collapsible?: boolean;
  unread?: number;
  onOpenChange?: (open: boolean) => void;
}

export function ChatPanel({
  messages, onSend, selfUserId,
  collapsible = false, unread = 0, onOpenChange,
}: ChatPanelProps) {
  const [open, setOpen] = useState(!collapsible);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  function submit() {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  }

  if (collapsible && !open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} title="Chat">
        💬{unread > 0 && <span className="chat-fab__badge">{unread}</span>}
      </button>
    );
  }

  return (
    <div className={`chat-panel ${collapsible ? 'chat-panel--overlay' : ''}`}>
      <div className="chat-panel__header">
        <span>Chat</span>
        {collapsible && (
          <button className="chat-panel__close" onClick={() => setOpen(false)}>✕</button>
        )}
      </div>

      <div className="chat-panel__list" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat-panel__empty">Say something…</p>
        )}
        {messages.map(m =>
          m.kind === 'system' ? (
            <p key={m.id} className="chat-msg chat-msg--system">{m.text}</p>
          ) : (
            <p key={m.id} className={`chat-msg ${m.userId === selfUserId ? 'chat-msg--self' : ''}`}>
              <span className="chat-msg__name">{m.userId === selfUserId ? 'you' : m.username}</span>
              {m.text}
            </p>
          )
        )}
      </div>

      <div className="chat-panel__inputrow">
        <input
          className="chat-panel__input"
          placeholder="Message…"
          value={draft}
          maxLength={300}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <button className="chat-panel__send" onClick={submit} disabled={!draft.trim()}>➤</button>
      </div>
    </div>
  );
}
