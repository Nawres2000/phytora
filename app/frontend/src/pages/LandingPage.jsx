import { Link } from "react-router-dom";
import { ScanLine, ArrowRight, ShieldCheck, Zap, Leaf } from "lucide-react";
import farmerBg from "../assets/farmer.png";
import logoImg from "../assets/logo.jpg";
export default function LandingPage() {
  return (
    <div className="relative min-h-screen bg-gray-900 text-white overflow-hidden">
      
      {/* 1. FOND ANIMÉ (Image de l'agriculteur avec effet de zoom lent) */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <img 
  src={farmerBg} 
  alt="Agriculteur dans son champ" 
  className="w-full h-full object-cover animate-[slowZoom_30s_ease-in-out_infinite]"
/>
        {/* Dégradé sombre pour que le texte ressorte bien sur le ciel et les plantes */}
        <div className="absolute inset-0 bg-gradient-to-r from-gray-900/90 via-gray-900/60 to-transparent" />
      </div>

      {/* 2. LIGNE DE SCAN (Effet "See beyond the leaf") */}
      <div className="absolute top-0 left-0 w-full h-[2px] bg-phytora-light shadow-[0_0_25px_5px_rgba(141,179,58,0.8)] animate-[scan_7s_ease-in-out_infinite] z-10" />
{/* 3. BARRE DE NAVIGATION */}
<nav className="relative z-20 flex justify-between items-center p-6 max-w-7xl mx-auto">
  {/* Logo à gauche */}
  <div className="flex items-center gap-3">
    <div className="bg-white p-1.5 rounded-full shadow-lg">
      <img src={logoImg} alt="Logo Phytora" className="w-8 h-8 object-contain" />
    </div>
    <span className="text-2xl font-bold tracking-widest text-white">PHYTORA</span>
  </div>

  {/* Boutons à droite */}
  <div className="flex gap-4">
    <Link to="/login" className="px-5 py-2 text-sm font-medium text-white hover:text-phytora-light transition">Connexion</Link>
    <Link to="/register" className="px-5 py-2 text-sm font-bold bg-phytora-light text-phytora-dark rounded-full hover:bg-white transition shadow-lg">S'inscrire</Link>
  </div>
</nav>

      {/* 4. CONTENU PRINCIPAL */}
      <main className="relative z-20 flex flex-col justify-center px-6 mt-20 md:mt-32 max-w-7xl mx-auto">
        
        {/* Alignement à gauche (l'image de l'agriculteur est à droite) */}
        <div className="max-w-2xl">
          
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-phytora-light/20 border border-phytora-light/30 text-phytora-light text-sm font-medium mb-8 animate-[fadeInUp_1s_ease-out]">
            <Zap size={16} /> IA de pointe pour l'agriculture de précision
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 animate-[fadeInUp_1s_ease-out_0.2s_both]">
  Voyez <span className="text-phytora-light">au-delà</span> de la feuille.
</h1>

          <p className="text-lg md:text-xl text-gray-200 max-w-xl mb-10 animate-[fadeInUp_1s_ease-out_0.4s_both]">
            Détectez les mauvaises herbes et diagnostiquez les maladies foliaires en quelques secondes. 
            PHYTORA associe la vision par ordinateur à votre expertise agronomique.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 animate-[fadeInUp_1s_ease-out_0.6s_both]">
            <Link to="/register" className="group flex items-center justify-center gap-2 px-8 py-4 bg-phytora-light text-phytora-dark font-bold rounded-full text-lg hover:bg-white transition-all shadow-lg shadow-phytora-light/20">
              Commencer gratuitement
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/login" className="px-8 py-4 bg-white/10 backdrop-blur-sm border border-white/20 text-white font-bold rounded-full text-lg hover:bg-white/20 transition-all">
              Se connecter
            </Link>
          </div>

        </div>

        {/* 5. CARTES DE FONCTIONNALITÉS (En bas) */}
        <div className="grid md:grid-cols-3 gap-6 mt-32 mb-16 animate-[fadeInUp_1s_ease-out_0.8s_both]">
          <div className="bg-black/30 backdrop-blur-md p-6 rounded-2xl border border-white/10 text-left">
            <Leaf className="text-phytora-light mb-4" size={28} />
            <h3 className="text-xl font-bold mb-2">Diagnostic foliaire</h3>
            <p className="text-gray-300 text-sm">Analysez les maladies de vos cultures à partir d'une simple photo.</p>
          </div>
          <div className="bg-black/30 backdrop-blur-md p-6 rounded-2xl border border-white/10 text-left">
            <ScanLine className="text-phytora-accent mb-4" size={28} />
            <h3 className="text-xl font-bold mb-2">Détection de mauvaises herbes</h3>
            <p className="text-gray-300 text-sm">Localisez avec précision les zones à traiter pour optimiser vos interventions.</p>
          </div>
          <div className="bg-black/30 backdrop-blur-md p-6 rounded-2xl border border-white/10 text-left">
            <ShieldCheck className="text-phytora-warn mb-4" size={28} />
            <h3 className="text-xl font-bold mb-2">Modèles traçables</h3>
            <p className="text-gray-300 text-sm">Une démarche MLOps rigoureuse pour des prédictions fiables et suivies.</p>
          </div>
        </div>
      </main>
    </div>
  );
}