'use client';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Shared state of the floating assistant: any page can open it and attach the current diagnosis.
const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [scan, setScan] = useState(null); // last diagnosis result (with scanId)
  const [request, setRequest] = useState(null); // { text, id } question to send right away

  const discuss = useCallback((result, text) => {
    setScan(result);
    setOpen(true);
    if (text) setRequest({ text, id: Date.now() });
  }, []);

  const value = useMemo(() => ({ open, setOpen, scan, setScan, discuss, request, clearRequest: () => setRequest(null) }), [open, scan, discuss, request]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export const useChat = () => useContext(ChatContext);
