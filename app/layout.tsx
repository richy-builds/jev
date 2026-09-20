import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Jev Live",
  description: "Watch Jev judge text in real time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
