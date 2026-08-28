"use client";

import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useState } from "react";
import Link from "next/link";
import { marked } from "marked";
import { Logo } from "./logo";

interface Message {
  id: string;
  role: "user" | "assistant" | "reminder";
  content: string;
  createdAt?: number;
}

function formatTime(epochMs: number): string {
  const date = new Date(epochMs);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function html(markdown: string): { __html: string } {
  // Personal, locally-owned data rendered by the user's own browser.
  return { __html: marked.parse(markdown, { async: false }) as string };
}

export default function HomePage(): React.ReactElement {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void fetch("/api/conversations/default")
        .then(async (response) => response.json() as Promise<{ messages: Message[] }>)
        .then((data) => {
          if (!cancelled && !isRunning) setMessages(data.messages);
        })
        .catch(() => {
          if (!cancelled) setError("无法读取本地对话记录。");
        });
    };

    load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isRunning]);

  async function sendMessage(): Promise<void> {
    const content = input.trim();
    if (!content || isRunning) return;

    setInput("");
    setError(null);
    setIsRunning(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() }]);
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "", createdAt: Date.now() }]);

    try {
      const response = await fetch("/api/conversations/default/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      });
      if (!response.ok || !response.body) throw new Error("Agent 请求失败。");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = decoder.decode(value, { stream: true });
        setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + delta } : message));
      }
    } catch (cause: unknown) {
      setMessages((current) => current.filter((message) => message.id !== assistantId));
      setError(cause instanceof Error ? cause.message : "Agent 请求失败。");
    } finally {
      setIsRunning(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends, Shift+Enter makes a newline. Never fire while the IME is
    // composing — that Enter belongs to confirming Chinese candidates.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <main>
      <header>
        <div className="brand">
          <Logo size={34} />
          <h1>大内总管</h1>
        </div>
        <nav>
          <Link href="/memory" className="pill">
            <svg width="14" height="14" viewBox="0 0 512 512" aria-hidden="true"><rect x="16" y="16" width="480" height="480" rx="112" fill="#D2452F"/><rect x="112" y="128" width="288" height="46" rx="23" fill="#fff"/><rect x="112" y="233" width="288" height="46" rx="23" fill="#fff"/><rect x="112" y="338" width="176" height="46" rx="23" fill="#fff"/></svg>
            记忆
          </Link>
        </nav>
      </header>
      <section aria-live="polite">
        {messages.length === 0 ? <p className="empty">告诉我一个承诺、待办或想法。</p> : messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <strong>{message.role === "user" ? "你" : message.role === "reminder" ? "提醒" : "总管"}</strong>
            {message.createdAt ? <time>{formatTime(message.createdAt)}</time> : null}
            {message.role === "user" ? (
              <p>{message.content}</p>
            ) : (
              <div className="md" dangerouslySetInnerHTML={message.content ? html(message.content) : { __html: isRunning ? "正在处理…" : "" }} />
            )}
          </article>
        ))}
      </section>
      <form onSubmit={handleSubmit}>
        <textarea value={input} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="输入消息…（Enter 发送 · Shift+Enter 换行）" rows={2} disabled={isRunning} />
        <button type="submit" className="send" disabled={isRunning || !input.trim()} aria-label="发送">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        </button>
      </form>
      {error ? <p className="error">{error}</p> : null}
      <style jsx>{`
        header { display: flex; justify-content: space-between; align-items: flex-start; }
        .brand { display: flex; gap: .65rem; align-items: center; }
        .brand :global(svg) { margin-top: .2rem; }
      `}</style>
    </main>
  );
}
