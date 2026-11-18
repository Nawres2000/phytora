import { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { Camera, Mail, Lock, CheckCircle2, User } from "lucide-react";

export default function Profile() {
  const { user, updateUser } = useAuth();
  
  // États pour le formulaire
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState(user?.avatar || null);
  const [successMsg, setSuccessMsg] = useState("");
  
  const fileInputRef = useRef(null);

  // Gérer le changement de photo
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatar(reader.result); // Met à jour l'aperçu
      };
      reader.readAsDataURL(file);
    }
  };

  // Sauvegarder les modifications
  const handleSave = (e) => {
    e.preventDefault();
    // On sauvegarde le nom, l'email et l'avatar
    updateUser({ name, email, avatar });
    setSuccessMsg("Profil mis à jour avec succès !");
    setTimeout(() => setSuccessMsg(""), 3000);
    setPassword(""); // Vide le champ mot de passe
  };

  return (
    <div className="p-8 md:p-12 max-w-4xl mx-auto">
      <header className="mb-10">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Profil & Paramètres</h1>
        <p className="text-gray-500">Gérez vos informations personnelles et votre compte.</p>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        
        <form onSubmit={handleSave}>
          {/* Bannière supérieure */}
          <div className="h-32 bg-gradient-to-r from-phytora-dark to-phytora-light"></div>
          
          <div className="px-8 pb-8">
            {/* Section Avatar */}
            <div className="relative flex justify-between items-end -mt-12 mb-8">
              <div className="relative group">
                <div className="w-24 h-24 rounded-full border-4 border-white bg-gray-200 overflow-hidden shadow-md flex items-center justify-center text-gray-400 text-3xl font-bold">
                  {avatar ? (
                    <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    user?.name?.charAt(0).toUpperCase()
                  )}
                </div>
                {/* Bouton pour changer la photo au survol */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current.click()}
                  className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-white"
                  title="Changer la photo"
                >
                  <Camera size={24} />
                </button>
                <input 
                  type="file" 
                  accept="image/*" 
                  ref={fileInputRef} 
                  onChange={handleImageChange} 
                  className="hidden" 
                />
              </div>
              
              <span className="text-sm text-gray-500 pb-2">
                Membre depuis Novembre 2026
              </span>
            </div>

            {/* Message de succès */}
            {successMsg && (
              <div className="mb-6 p-4 bg-green-50 text-green-700 rounded-xl flex items-center gap-2 border border-green-200">
                <CheckCircle2 size={20} /> {successMsg}
              </div>
            )}

            {/* Formulaire */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Informations de base */}
              <div className="space-y-5">
                <h3 className="text-lg font-bold text-gray-800 border-b pb-2">Informations personnelles</h3>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                    <User size={16} className="text-phytora-dark" /> Nom d'utilisateur
                  </label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={(e) => setName(e.target.value)}
                    className="input-phytora"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                    <Mail size={16} className="text-phytora-dark" /> Adresse Email
                  </label>
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input-phytora"
                    required
                  />
                </div>
              </div>

              {/* Sécurité */}
              <div className="space-y-5">
                <h3 className="text-lg font-bold text-gray-800 border-b pb-2">Sécurité</h3>
                
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5 flex items-center gap-2">
                    <Lock size={16} className="text-phytora-dark" /> Nouveau mot de passe
                  </label>
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Laisser vide pour ne pas changer"
                    className="input-phytora"
                  />
                  <p className="text-xs text-gray-400 mt-1">Laissez ce champ vide si vous ne voulez pas modifier votre mot de passe.</p>
                </div>
              </div>
            </div>

            {/* Boutons d'action */}
            <div className="mt-10 pt-6 border-t border-gray-100 flex justify-end gap-4">
              <button type="button" className="px-6 py-2.5 text-gray-600 font-medium hover:bg-gray-100 rounded-xl transition">
                Annuler
              </button>
              {/* J'ai remplacé "bg-phytora-dark" par le style de ton bouton principal pour être sûr qu'il soit vert */}
             <button 
  type="submit" 
  className="px-8 py-2.5 rounded-xl font-bold shadow-lg transition btn-save"
>
  Enregistrer les modifications
</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}