import type { Metadata, Viewport } from "next";
import { Inter, Montserrat, Pixelify_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], weight: ["700", "800"] });
const pixel = Pixelify_Sans({ variable: "--font-pixel", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: "Portal do Mago",
  description: "O Salão do Grimório: a comunidade dos alunos do Mago do YouTube. Entre, ande pelo salão e converse com a galera.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${montserrat.variable} ${pixel.variable}`}>
      <body>{children}</body>
    </html>
  );
}
