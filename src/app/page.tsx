import { Bot } from "lucide-react";
import Link from "next/link";
import { ChatWindow } from "@/components/chat/chat-window";
export default function Home() {
  return (
    <main className="app-shell">
      <header className="brand-bar">
        <Link href="/" className="brand" aria-label="Kagen AI home">
          <span className="brand-mark">K</span>
          <span>KAGEN</span>
        </Link>
        <Link href="/widget-preview" className="preview-link">
          Widget preview
        </Link>
      </header>
      <section className="hero">
        <div className="eyebrow">
          <Bot size={15} /> AI-powered website assistant
        </div>
        <h1>How can we help you explore Kagen?</h1>
        <p>
          Ask about products, Kagen PRISM, customer stories, resources, events,
          or getting in touch.
        </p>
      </section>
      <ChatWindow />
      <footer className="footer">
        Answers are grounded in content from the official Kagen website. AI can
        make mistakes.
      </footer>
    </main>
  );
}
