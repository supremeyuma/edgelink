import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EdgeLink dashboard",
  description: "Click analytics for edge-deployed short links",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
