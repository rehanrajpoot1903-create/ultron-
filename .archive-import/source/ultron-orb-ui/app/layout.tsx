import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ULTRON // CORE INTERFACE",
  description:
    "A fractured wireframe intelligence core — drag, scroll, or use hand gestures to interrogate it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
