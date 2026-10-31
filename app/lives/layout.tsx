import type { Metadata } from "next";
import "../oraculo/oraculo.css";
import "./lives.css";

export const metadata: Metadata = {
  title: "Lives anteriores · Portal do Mago",
  description: "As lives do Palco gravadas, com o minuto certo de cada assunto.",
  robots: { index: false, follow: false },
};

export default function LivesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
