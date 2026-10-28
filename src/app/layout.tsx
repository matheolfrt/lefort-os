import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { getTheme } from "@/lib/prefs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lefort OS",
  description: "Système d'exploitation de Lefort Second Hand",
  appleWebApp: { capable: true, title: "Lefort OS", statusBarStyle: "black-translucent" },
};

// Browser bar colour follows the theme (dark by default; light and « auto » are options of the menu)
export async function generateViewport(): Promise<Viewport> {
  const theme = await getTheme();
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: theme === "light" ? "#f3f6f3"
      : theme === "auto" ? [{ media: "(prefers-color-scheme: light)", color: "#f3f6f3" }, { media: "(prefers-color-scheme: dark)", color: "#0a110e" }]
      : "#0a110e",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getTheme();
  return (
    <html lang="fr" data-theme={theme} className={`${theme === "dark" ? "dark " : ""}${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
