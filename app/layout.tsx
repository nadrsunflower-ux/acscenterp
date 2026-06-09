import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "악센트 운영 관리",
  description: "악센트 아이디 / 와우 매장 운영 관리 사이트",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen font-sans antialiased">
        <Nav />
        <main className="mx-auto w-full px-2 py-4 sm:px-4">
          {children}
        </main>
      </body>
    </html>
  );
}
