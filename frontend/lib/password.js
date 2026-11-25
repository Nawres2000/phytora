export const RULES = [
  ['Au moins 8 caractères', (p) => p.length >= 8],
  ['Une lettre minuscule', (p) => /[a-z]/.test(p)],
  ['Une lettre majuscule', (p) => /[A-Z]/.test(p)],
  ['Un chiffre', (p) => /[0-9]/.test(p)],
  ['Un caractère spécial', (p) => /[^A-Za-z0-9]/.test(p)],
];
export const passwordOk = (p) => p.length <= 72 && RULES.every(([, test]) => test(p));
