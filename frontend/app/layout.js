import './globals.css';
import { AuthProvider } from '@/context/AuthContext';

export const metadata = {
  title: 'PHYTORA – Voyez au-delà de la feuille',
  description: 'Diagnostic des maladies foliaires par intelligence artificielle, explicable, avec assistant agronomique.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="antialiased"><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
