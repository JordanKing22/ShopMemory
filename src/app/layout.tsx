import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Floorwise (demo)",
  description: "Floorwise captures machine-shop know-how. Demo software: all data is fictional.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
