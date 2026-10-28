import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContaExpress | Gestão contabilística",
  description:
    "Plataforma de gestão contabilística, fiscal e financeira para operações empresariais em Moçambique.",
  applicationName: "ContaExpress",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-MZ">
      <body>{children}</body>
    </html>
  );
}
