const API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL = process.env.BETTER_AUTH_EMAIL_FROM || 'reyseilfullbryger@gmail.com';
const APP_NAME = 'WebMediia';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function apiKey(): string {
  const key = process.env.BREVO_API_KEY?.trim();
  if (!key) throw new Error('BREVO_API_KEY is not set');
  return key;
}

function baseHtml(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
  a{color:#3b82f6}
</style></head>
<body style="margin:0;padding:0;background-color:#f1f5f9">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9"><tr><td align="center" style="padding:40px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
<tr><td align="center" style="padding:0 0 28px">
  <span style="font-size:20px;font-weight:800;color:#1e293b;letter-spacing:-0.5px">${APP_NAME}</span>
</td></tr>
<tr><td style="background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 8px 30px rgba(0,0,0,0.05)">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td style="height:3px;background:linear-gradient(90deg,#60a5fa,#3b82f6,#93c5fd)"></td></tr>
<tr><td style="padding:44px 36px 32px">
<h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.4px">${title}</h1>
${content}
</td></tr>
<tr><td style="padding:20px 36px;border-top:1px solid #e2e8f0"><table width="100%"><tr><td style="text-align:left"><p style="margin:0;font-size:12px;color:#94a3b8">${APP_NAME} &mdash; Films, s&eacute;ries, animes &amp; plus</p></td><td style="text-align:right"><p style="margin:0;font-size:12px;color:#94a3b8">&copy; 2026</p></td></tr></table></td></tr>
</table>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function ctaButton(url: string, text: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 36px"><tr><td align="center" style="background-color:#3b82f6;border-radius:10px;padding:0">
<a href="${url}" target="_blank" style="display:inline-block;padding:14px 40px;font-size:15px;font-weight:600;color:#ffffff !important;text-decoration:none;letter-spacing:0.3px;white-space:nowrap">${text}</a>
</td></tr></table>`;
}

export function buildVerificationEmail(name: string, url: string): { subject: string; html: string } {
  const content = `
<p style="margin:0 0 8px;font-size:15px;color:#475569;line-height:1.8">
Bonjour${name ? ' ' + escapeHtml(name) : ''},
</p>
<p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.8">
Merci de t&rsquo;&ecirc;tre inscrit sur <strong style="color:#0f172a">${APP_NAME}</strong>.
Pour activer ton compte et acc&eacute;der &agrave; tout le contenu, confirme ton adresse email en cliquant sur le bouton ci-dessous.
</p>
${ctaButton(url, 'Confirmer mon adresse email')}
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><tr><td style="padding:18px 20px">
<p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#334155">
Le bouton ne fonctionne pas ?
</p>
<p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">
Copie ce lien dans ton navigateur :<br>
<a href="${url}" style="color:#3b82f6;word-break:break-all">${url}</a>
</p>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;color:#94a3b8;line-height:1.6">
Ce lien expire dans <strong style="color:#64748b">1 heure</strong>.<br>
Si tu n&rsquo;as pas cr&eacute;&eacute; de compte, ignore cet email.
</p>
`.trim();
  return { subject: `Confirme ton email - ${APP_NAME}`, html: baseHtml('V&eacute;rifie ton email', content) };
}

export function buildResetEmail(name: string, url: string): { subject: string; html: string } {
  const content = `
<p style="margin:0 0 8px;font-size:15px;color:#475569;line-height:1.8">
Bonjour${name ? ' ' + escapeHtml(name) : ''},
</p>
<p style="margin:0 0 32px;font-size:15px;color:#475569;line-height:1.8">
Tu as demand&eacute; la r&eacute;initialisation de ton mot de passe <strong style="color:#0f172a">${APP_NAME}</strong>.
Clique sur le bouton ci-dessous pour en cr&eacute;er un nouveau.
</p>
${ctaButton(url, 'R&eacute;initialiser mon mot de passe')}
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border-radius:10px;border:1px solid #e2e8f0"><tr><td style="padding:18px 20px">
<p style="margin:0;font-size:13px;color:#64748b;line-height:1.6">
<strong style="color:#334155">Pas toi ?</strong> Ignore cet email, ton mot de passe reste inchang&eacute;.<br>
<span style="color:#94a3b8">Ce lien expire dans 1 heure.</span>
</p>
</td></tr></table>
`.trim();
  return { subject: `R\u00e9initialisation mot de passe - ${APP_NAME}`, html: baseHtml('R\u00e9initialisation mot de passe', content) };
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: APP_NAME, email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo API ${res.status}: ${body.slice(0, 200)}`);
  }
}
