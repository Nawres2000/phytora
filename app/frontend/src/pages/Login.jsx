import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import logoImg from "../assets/logo.jpg";
import authBg from "../assets/auth-bg.webp"; // <-- Import de la nouvelle image

export default function Login() {
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
        
        {/* L'image de fond avec animation de zoom */}
        <div className="absolute inset-0 z-0">
          <img 
            src={authBg} 
            alt="Agriculteur utilisant Phytora" 
            className="w-full h-full object-cover animate-[slowZoom_30s_ease-in-out_infinite]"
          />
          {/* Voile sombre pour lire le texte */}
          <div className="absolute inset-0 bg-black/40" />
        </div>

        {/* Logo (au-dessus de l'image) */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="bg-white p-2 rounded-full">
            <img src={logoImg} alt="Logo" className="w-8 h-8 object-contain" />
          </div>
          <span className="text-2xl font-bold text-white tracking-widest">PHYTORA</span>
        </div>

        {/* Citation */}
        <div className="relative z-10 mb-20">
          <h2 className="text-4xl font-bold text-white mb-4 leading-tight drop-shadow-lg">
            "See beyond<br />the leaf."
          </h2>
          <p className="text-white/90 text-lg max-w-md drop-shadow-md">
            L'intelligence artificielle au service de vos cultures. Analysez vos parcelles en un clic.
          </p>
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

          <h2 className="text-3xl font-extrabold text-gray-900 mb-2">Bon retour !</h2>
          <p className="text-gray-500 mb-8">Connectez-vous pour accéder à votre tableau de bord.</p>

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
              <div className="flex justify-between items-center mb-1.5">
                <label className="block text-sm font-semibold text-gray-700">Mot de passe</label>
                <a href="#" className="text-xs text-phytora-accent hover:underline">Oublié ?</a>
              </div>
              <div className="relative">
                <input 
                  type={showPassword ? "text" : "password"} required 
                  className="input-phytora pr-12"
                  placeholder="••••••••"
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
              Se connecter
            </button>
          </form>

          <p className="text-center text-sm text-gray-600 mt-8">
            Pas encore de compte ?{" "}
            <Link to="/register" className="text-phytora-dark font-bold hover:text-phytora-accent hover:underline transition">
              Créer un compte
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}