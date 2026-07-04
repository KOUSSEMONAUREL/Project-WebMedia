const API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL = process.env.BETTER_AUTH_EMAIL_FROM || 'reyseilfullbryger@gmail.com';
const APP_NAME = 'WebMedia';
const BRAND_GRADIENT = 'linear-gradient(135deg, #60a5fa, #3b82f6)';

function apiKey(): string {
  const key = process.env.BREVO_API_KEY?.trim();
  if (!key) throw new Error('BREVO_API_KEY is not set');
  return key;
}

function baseHtml(content: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background-color:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
  a{color:#60a5fa;text-decoration:none}
</style></head>
<body style="margin:0;padding:0;background-color:#0a0a0f">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0f"><tr><td align="center" style="padding:24px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;background-color:#12121a;box-shadow:0 8px 32px rgba(0,0,0,0.4)">
<tr><td style="background:${BRAND_GRADIENT};padding:32px 24px;text-align:center">
<table width="100%"><tr><td style="text-align:center">
<div style="display:inline-block;width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,0.15);text-align:center;line-height:44px;margin-bottom:8px">
<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5-2 7h10l-2 7"/><rect x="3" y="3" width="18" height="18" rx="4"/></svg>
</div>
<h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-0.3px">${APP_NAME}</h1>
</td></tr></table>
</td></tr>
<tr><td style="padding:32px 24px">${content}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.06);text-align:center">
<p style="margin:0;font-size:12px;color:#52525b">${APP_NAME} &mdash; Tous droits r&eacute;serv&eacute;s</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function ctaButton(url: string, text: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px auto"><tr><td align="center" style="background:${BRAND_GRADIENT};border-radius:12px;padding:14px 36px">
<a href="${url}" target="_blank" style="display:inline-block;font-size:15px;font-weight:600;color:#fff;text-decoration:none;white-space:nowrap">${text}</a>
</td></tr></table>`;
}

export function buildVerificationEmail(name: string, url: string): { subject: string; html: string } {
  const content = `
<p style="margin:0 0 6px;font-size:14px;color:#a1a1aa">Bonjour${name ? ' ' + name : ''},</p>
<p style="margin:0 0 20px;font-size:14px;color:#a1a1aa;line-height:1.6">
Merci de vous &ecirc;tre inscrit sur <strong style="color:#e4e4e7">${APP_NAME}</strong>.
Pour finaliser votre inscription, veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous.
</p>
${ctaButton(url, 'Confirmer mon email')}
<p style="margin:24px 0 0;font-size:12px;color:#52525b">
Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur&nbsp;:<br>
<a href="${url}" style="color:#60a5fa;font-size:12px;word-break:break-all">${url}</a>
</p>
<p style="margin:16px 0 0;font-size:12px;color:#52525b">Ce lien expire dans 1 heure.</p>
`.trim();
  return { subject: `Confirme ton email - ${APP_NAME}`, html: baseHtml(content) };
}

export function buildResetEmail(name: string, url: string): { subject: string; html: string } {
  const content = `
<p style="margin:0 0 6px;font-size:14px;color:#a1a1aa">Bonjour${name ? ' ' + name : ''},</p>
<p style="margin:0 0 20px;font-size:14px;color:#a1a1aa;line-height:1.6">
Vous avez demand&eacute; la r&eacute;initialisation de votre mot de passe ${APP_NAME}.
Cliquez sur le bouton ci-dessous pour en cr&eacute;er un nouveau.
</p>
${ctaButton(url, 'Reinitialiser mon mot de passe')}
<p style="margin:24px 0 0;font-size:12px;color:#52525b">
Si vous n'&ecirc;tes pas &agrave; l'origine de cette demande, ignorez cet email.
</p>
<p style="margin:16px 0 0;font-size:12px;color:#52525b">Ce lien expire dans 1 heure.</p>
`.trim();
  return { subject: `Reinitialisation mot de passe - ${APP_NAME}`, html: baseHtml(content) };
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
