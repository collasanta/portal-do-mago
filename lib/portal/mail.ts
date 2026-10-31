import "server-only";

// Transactional e-mail through Resend (already-verified domain; sender configurable with PORTAL_EMAIL_FROM).
const FROM = process.env.PORTAL_EMAIL_FROM || "Portal do Mago <onboarding@resend.dev>";

export function mailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendLoginCode(to: string, code: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY ausente");
  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  const html = `<!doctype html><html><body style="margin:0;background:#14111f;font-family:Arial,Helvetica,sans-serif;color:#efe9ff">
<div style="max-width:440px;margin:0 auto;padding:32px 24px">
  <p style="font-size:15px;margin:0 0 6px">🧙 <b>Portal do Mago</b> · Salão do Grimório</p>
  <p style="font-size:15px;line-height:1.5;margin:18px 0">Seu código de acesso:</p>
  <p style="font-size:34px;letter-spacing:6px;font-weight:bold;background:#231d38;border-radius:10px;padding:16px;text-align:center;margin:0">${pretty}</p>
  <p style="font-size:13px;line-height:1.5;color:#b7add6;margin:18px 0 0">Vale por 10 minutos. Se não foi você que pediu, é só ignorar este e-mail.</p>
</div></body></html>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: `${pretty} é seu código do Portal do Mago`,
      html,
      text: `Seu código do Portal do Mago: ${pretty}\nVale por 10 minutos. Se não foi você que pediu, ignore este e-mail.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);
}
