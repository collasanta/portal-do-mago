import type { Metadata } from "next";
import "./membros.css";

export const metadata: Metadata = {
  title: "Membros · Portal do Mago",
  robots: { index: false, follow: false },
};

export default function MembrosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
