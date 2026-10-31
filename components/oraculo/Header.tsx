import Link from "next/link";

export function Sparkle({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c.4 3.9 1.6 6.1 3.4 7.3 1.3.9 3 1.4 5.1 1.7-2.1.3-3.8.8-5.1 1.7-1.8 1.2-3 3.4-3.4 7.3-.4-3.9-1.6-6.1-3.4-7.3-1.3-.9-3-1.4-5.1-1.7 2.1-.3 3.8-.8 5.1-1.7C10.4 8.6 11.6 6.4 12 2.5z" />
    </svg>
  );
}

/** Cabeçalho do Oráculo (some no modo ?embed=1). */
export default function Header({ active, onMenu }: { active: "chat" | "aulas" | "lives"; onMenu?: () => void }) {
  return (
    <header className="orc-header">
      {onMenu && (
        <button type="button" onClick={onMenu} className="orc-icon-btn orc-only-narrow" aria-label="Conversas">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      )}
      <Link href="/" className="orc-back" aria-label="Voltar para a sala">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        <span className="orc-hide-xs">Sala</span>
      </Link>
      <span className="orc-brand"><Sparkle size={16} /> Oráculo do Mago</span>
      <nav className="orc-tabs">
        <Link href="/oraculo" className={active === "chat" ? "orc-tab orc-tab-on" : "orc-tab"}>Perguntar</Link>
        <Link href="/oraculo/aulas" className={active === "aulas" ? "orc-tab orc-tab-on" : "orc-tab"}>Aulas</Link>
        <Link href="/lives" className={active === "lives" ? "orc-tab orc-tab-on" : "orc-tab"}>Lives</Link>
      </nav>
    </header>
  );
}
