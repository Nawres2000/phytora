import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import logoImg from "../assets/logo.jpg";
import authBg from "../assets/auth-bg.webp"; // <-- Import de la nouvelle image

export default function Register() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    login(email); 
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen flex bg-white">
      
      {/* --- PARTIE GAUCHE (Image animée) --- */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden flex-col justify-between p-12">
        
        <div className="absolute inset-0 z-0">
          <img 
            src={authBg} 
            alt="Agriculteur utilisant Phytora" 
            className="w-full h-full object-cover animate-[slowZoom_30s_ease-in-out_infinite]"
          />
          <div className="absolute inset-0 bg-black/40" />
        </div>

        <div className="relative z-10 flex items-center gap-3">
          <div className="bg-white p-2 rounded-full">
            <img src={logoImg} alt="Logo" className="w-8 h-8 object-contain" />
          </div>
          <span className="text-2xl font-bold text-white tracking-widest">PHYTORA</span>
        </div>

        <div className="relative z-10 mb-20">
          <h2 className="text-4xl font-bold text-white mb-6 leading-tight drop-shadow-lg">
            Rejoignez la révolution<br />agricole.
          </h2>
          <ul className="space-y-4 text-white/90 drop-shadow-md">
            <li className="flex items-center gap-3"><CheckCircle2 size={20} /> Détection IA en temps réel</li>
            <li className="flex items-center gap-3"><CheckCircle2 size={20} /> Diagnostic des maladies foliaires</li>
            <li className="flex items-center gap-3"><CheckCircle2 size={20} /> Historique de vos parcelles</li>
          </ul>
        </div>
      </div>

      {/* --- PARTIE DROITE (Formulaire) --- */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 relative">
        <Link to="/" className="absolute top-8 left-8 text-gray-400 hover:text-phytora-dark transition flex items-center gap-2 text-sm font-medium">
          <ArrowLeft size={16} /> Retour
        </Link>

        <div className="w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-8">
            <img src={logoImg} alt="Logo" className="w-16 h-16 object-contain" />
          </div>

          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Créer un compte</h2>
          <p className="text-gray-500 mb-8">Commencez à analyser vos cultures dès aujourd'hui.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Adresse Email</label>
              <input 
                type="email" required 
                className="input-phytora"
                placeholder="vous@exemple.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mot de passe</label>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} required 
                  className="input-phytora pr-12"
                  placeholder="Créez un mot de passe fort"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-phytora mt-2">
              S'inscrire gratuitement
            </button>
          </form>

          <p className="text-center text-sm text-gray-600 mt-8">
            Déjà un compte ?{" "}
            <Link to="/login" className="text-phytora-dark font-bold hover:text-phytora-accent hover:underline transition">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}