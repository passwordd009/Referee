import { useEffect, useState, useCallback, useRef } from 'react';
import { socket } from '../lib/socket';

export interface ChatMessage {
  id: number;
  kind: 'chat' | 'system';
  userId?: string;
  username?: string;
  text: string;
  ts: number;
}

let nextId = 1;

/**
 * Room chat: player messages + referee/system lines. Lobby and match
 * share the channel, so history carries across the transition as long
 * as the component stays mounted (each page keeps its own view).
 */
export function useChat(roomCode: string, userId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(true);

  useEffect(() => {
    function onChat(msg: { userId: string; username: string; text: string; ts: number }) {
      setMessages(m => [...m.slice(-199), { id: nextId++, kind: 'chat', ...msg }]);
      if (!openRef.current) setUnread(u => u + 1);
    }
    function onSystem(msg: { text: string; ts: number }) {
      setMessages(m => [...m.slice(-199), { id: nextId++, kind: 'system', ...msg }]);
    }
    socket.on('chat_message', onChat);
    socket.on('system_message', onSystem);
    return () => {
      socket.off('chat_message', onChat);
      socket.off('system_message', onSystem);
    };
  }, [roomCode]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    socket.emit('chat_message', { roomCode, userId, text: trimmed });
  }, [roomCode, userId]);

  const setOpen = useCallback((open: boolean) => {
    openRef.current = open;
    if (open) setUnread(0);
  }, []);

  return { messages, send, unread, setOpen };
}
