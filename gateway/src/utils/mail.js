import nodemailer from 'nodemailer';

async function send(to, subject, html, link) {
  if (!process.env.SMTP_HOST) return console.log(`[dev] "${subject}" pour ${to} -> ${link}`);
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await t.sendMail({ from: process.env.MAIL_FROM, to, subject, html });
}

export const sendResetEmail = (to, link) => send(to, 'Réinitialisez votre mot de passe PHYTORA',
  `<p>Cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe. Il expire dans 30 minutes.</p><p><a href="${link}">Réinitialiser mon mot de passe</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`, link);

export const sendVerifyEmail = (to, link) => send(to, 'Confirmez votre e-mail PHYTORA',
  `<p>Bienvenue sur PHYTORA ! Confirmez votre adresse e-mail pour finaliser votre compte. Ce lien expire dans 24 heures.</p><p><a href="${link}">Confirmer mon e-mail</a></p><p>Si vous n'avez pas créé de compte, ignorez ce message.</p>`, link);
