import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Kagen AI Assistant",
  description:
    "Explore Kagen products, insights, case studies, and events with an AI-powered assistant.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
