import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import Logo from './Logo';
import authBg from '@/assets/auth-bg.webp';

export default function AuthShell({ variant = 'login', children }) {
  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:flex w-1/2 relative overflow-hidden flex-col justify-between p-12">
        <div className="absolute inset-0 z-0">
          <Image src={authBg} alt="Agriculteur utilisant PHYTORA" fill priority sizes="50vw"
            className="object-cover animate-[slowZoom_30s_ease-in-out_infinite]" />
          <div className="absolute inset-0 bg-black/40" />
        </div>
        <div className="relative z-10"><Logo light size={32} /></div>
        <div className="relative z-10 mb-20">
          {variant === 'register' ? (<>
            <h2 className="text-4xl font-bold text-white mb-6 leading-tight drop-shadow-lg">Rejoignez la révolution<br />agricole.</h2>
            <ul className="space-y-4 text-white/90 drop-shadow-md">
              <li className="flex items-center gap-3"><CheckCircle2 size={20} /> Détection IA en temps réel</li>
              <li className="flex items-center gap-3"><CheckCircle2 size={20} /> Diagnostic des maladies foliaires</li>
              <li className="flex items-center gap-3"><CheckCircle2 size={20} /> Historique de vos parcelles</li>
            </ul>
          </>) : (<>
            <h2 className="text-4xl font-bold text-white mb-4 leading-tight drop-shadow-lg">&ldquo;See beyond<br />the leaf.&rdquo;</h2>
            <p className="text-white/90 text-lg max-w-md drop-shadow-md">L&rsquo;intelligence artificielle au service de vos cultures. Analysez vos parcelles en un clic.</p>
          </>)}
        </div>
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative">
        <Link href="/" className="absolute top-8 left-8 text-gray-400 hover:text-phytora-dark transition flex items-center gap-2 text-sm font-medium">
          <ArrowLeft size={16} /> Retour
        </Link>
        <div className="w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-8"><Logo size={40} /></div>
          {children}
        </div>
      </div>
    </div>
  );
}
