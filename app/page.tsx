"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant" | "reminder";
  content: string;
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

  async function sendMessage(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const content = input.trim();
    if (!content || isRunning) return;

    setInput("");
    setError(null);
    setIsRunning(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content }]);
    const assistantId = crypto.randomUUID();
    setMessages((current) => [...current, { id: assistantId, role: "assistant", content: "" }]);

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

  return (
    <main>
      <header>
        <p>本地个人 Agent</p>
        <h1>大内总管</h1>
      </header>
      <section aria-live="polite">
        {messages.length === 0 ? <p className="empty">告诉我一个承诺、待办或想法。</p> : messages.map((message) => (
          <article className={`message ${message.role}`} key={message.id}>
            <strong>{message.role === "user" ? "你" : message.role === "reminder" ? "提醒" : "总管"}</strong>
            <p>{message.content || (isRunning ? "正在处理…" : "")}</p>
          </article>
        ))}
      </section>
      <form onSubmit={sendMessage}>
        <textarea value={input} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setInput(event.target.value)} placeholder="输入消息…" rows={3} disabled={isRunning} />
        <button type="submit" disabled={isRunning || !input.trim()}>{isRunning ? "处理中" : "发送"}</button>
      </form>
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}
