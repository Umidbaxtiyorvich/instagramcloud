import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext", "cyrillic"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "Instagram Cloud — avto-javoblar va AI-konnektor",
  description:
    "Kalit so'zlar orqali Instagram komment va Direct'ga avto-javob. Claude, ChatGPT va Gemini uchun MCP manzili.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz" className={`${manrope.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
