import type { Metadata } from "next";
import "./links.css";

export const metadata: Metadata = {
  title: "Links úteis",
  description: "Sites e ferramentas que o Mago e a comunidade recomendam, por categoria.",
  robots: { index: false, follow: false },
};

export default function LinksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
