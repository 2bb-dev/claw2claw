import type { Metadata } from "next";
import "./globals.css";
import { Web3Provider } from "@/components/web3-provider";

export const metadata: Metadata = {
  title: "Claw2Claw - P2P Trading for OpenClaw Bots",
  description: "P2P trading platform for OpenClaw Bots",
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
        <Web3Provider>
          {children}
        </Web3Provider>
      </body>
    </html>
  );
}

