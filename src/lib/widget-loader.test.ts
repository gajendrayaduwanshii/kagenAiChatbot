import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

describe("public widget loader", () => {
  it("initializes once and supports the public open/close/destroy API", () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body><script src="https://widget.example/kagen-chat-widget.js" data-open-by-default="false"></script></body></html>',
      { url: "https://kagen.ai/page", runScripts: "outside-only" },
    );
    Object.defineProperty(dom.window, "matchMedia", {
      value: () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    const source = readFileSync("public/kagen-chat-widget.js", "utf8");
    dom.window.eval(source);
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const api = (
      dom.window as unknown as {
        KagenChat: {
          open(): void;
          close(): void;
          destroy(): void;
          isOpen(): boolean;
        };
      }
    ).KagenChat;
    expect(api.isOpen()).toBe(false);
    expect(
      dom.window.document.querySelectorAll("#kagen-chat-widget-root"),
    ).toHaveLength(1);
    expect(dom.window.document.querySelector("iframe")).toBeNull();
    api.open();
    expect(api.isOpen()).toBe(true);
    expect(dom.window.document.querySelector("iframe")?.src).toContain(
      "https://widget.example/embed?",
    );
    api.close();
    expect(api.isOpen()).toBe(false);
    dom.window.eval(source);
    expect(
      dom.window.document.querySelectorAll("#kagen-chat-widget-root"),
    ).toHaveLength(1);
    api.destroy();
    expect(
      dom.window.document.querySelector("#kagen-chat-widget-root"),
    ).toBeNull();
  });
  it("locks and restores host scrolling for a mobile fullscreen widget", () => {
    const dom = new JSDOM(
      '<!doctype html><html><head></head><body><script src="https://widget.example/kagen-chat-widget.js" data-mobile-fullscreen="true"></script></body></html>',
      { url: "https://kagen.ai/page", runScripts: "outside-only" },
    );
    Object.defineProperty(dom.window, "matchMedia", {
      value: () => ({
        matches: true,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
    dom.window.eval(readFileSync("public/kagen-chat-widget.js", "utf8"));
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    const api = (
      dom.window as unknown as { KagenChat: { open(): void; close(): void } }
    ).KagenChat;
    api.open();
    expect(dom.window.document.documentElement.style.overflow).toBe("hidden");
    api.close();
    expect(dom.window.document.documentElement.style.overflow).toBe("");
  });
});
