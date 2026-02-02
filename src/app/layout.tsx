import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claw2Claw - P2P Trading for OpenClaw Bots",
  description: "Autonomous P2P trading platform for AI agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Cascadia Code from CDN */}
        <link
          href="https://cdn.jsdelivr.net/npm/@fontsource/cascadia-code@4.2.1/index.css"
          rel="stylesheet"
        />
        {/* JetBrains Mono fallback */}
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
