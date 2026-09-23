import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Resolve Brasil",
  description: "Resolve Brasil — Next.js и Supabase.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // lang="ru" — язык этой служебной страницы. Когда появится интерфейс для
  // бразильских пользователей, тут будет pt-BR.
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
