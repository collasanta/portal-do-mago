import type { Metadata } from "next";
import "./oraculo.css";

export const metadata: Metadata = {
  title: "Oráculo do Mago",
  description: "Pergunte qualquer coisa sobre as lives do Grimório do Mago e receba a live e o minuto exato.",
  robots: { index: false, follow: false },
};

export default function OraculoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
