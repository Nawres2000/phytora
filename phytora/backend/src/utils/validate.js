import dns from 'dns/promises';

export function passwordError(p = '') {
  if (p.length < 8) return 'Utilisez au moins 8 caractères.';
  if (p.length > 72) return 'Utilisez au plus 72 caractères.';
  if (!/[a-z]/.test(p)) return 'Ajoutez une lettre minuscule.';
  if (!/[A-Z]/.test(p)) return 'Ajoutez une lettre majuscule.';
  if (!/[0-9]/.test(p)) return 'Ajoutez un chiffre.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Ajoutez un caractère spécial (par exemple ! @ # $).';
  return null;
}

const DISPOSABLE = new Set(['mailinator.com', 'yopmail.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com']);

// Syntax + disposable check + the domain must be able to receive mail (MX record).
// Whether the mailbox itself exists is proven by the verification link sent after signup.
export async function emailError(email = '') {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Entrez une adresse e-mail valide.';
  const domain = email.split('@')[1].toLowerCase();
  if (DISPOSABLE.has(domain)) return "Les adresses e-mail jetables ne sont pas acceptées.";
  if (process.env.SKIP_MX_CHECK === '1') return null;
  try {
    const mx = await dns.resolveMx(domain);
    if (!mx.length) return "Ce domaine e-mail ne peut pas recevoir de courrier.";
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return "Ce domaine e-mail n'existe pas. Vérifiez la saisie.";
    // other DNS errors (timeouts, offline): don't block the user
  }
  return null;
}
