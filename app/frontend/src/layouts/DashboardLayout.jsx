import { useState } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import logoImg from "../assets/logo.jpg"; // <-- Vérifie bien que c'est .png
import { 
  LogOut, 
  LayoutDashboard, 
  ScanLine, 
  History, 
  Leaf, 
  BookOpen, 
  Menu, 
  X, 
  User,
  Settings 
} from "lucide-react";

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // État pour ouvrir/fermer le menu (sur PC et Mobile)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); 

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

  const navItems = [
    { path: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={20} /> },
    { path: "/dashboard/detection", label: "AI Detection", icon: <ScanLine size={20} /> },
    { path: "/dashboard/history", label: "Detection History", icon: <History size={20} /> },
    { path: "/dashboard/crops", label: "My Crops", icon: <Leaf size={20} /> },
    { path: "/dashboard/guide", label: "Plant Disease Guide", icon: <BookOpen size={20} /> },
    { path: "/dashboard/profile", label: "Profile & Settings", icon: <User size={20} /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-hidden">
      
      {/* Overlay sombre (uniquement sur mobile quand le menu est ouvert) */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden" 
          onClick={closeSidebar}
        />
      )}

      {/* --- LA SIDEBAR --- */}
      <aside className={`
        fixed md:relative top-0 left-0 h-screen z-50 bg-white border-r border-gray-200 flex flex-col
        transform transition-all duration-300 ease-in-out
        ${isSidebarOpen ? "translate-x-0 w-72" : "-translate-x-full md:translate-x-0 md:w-0 md:opacity-0 md:overflow-hidden"}
      `}>
        
        {/* Entête de la sidebar (Logo + Bouton fermer) */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="bg-phytora-light/20 p-1.5 rounded-full">
              <img src={logoImg} alt="Logo" className="w-7 h-7 object-contain" />
            </div>
            <span className="text-xl font-bold text-phytora-dark tracking-wider">PHYTORA</span>
          </div>
          {/* Bouton pour fermer (visible sur PC et mobile) */}
          <button onClick={closeSidebar} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>
        
        {/* Menu de navigation */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-2">Main Menu</div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => { if(window.innerWidth < 768) closeSidebar(); }} 
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                    isActive 
                      ? "bg-phytora-light/15 text-phytora-dark font-semibold" 
                      : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {item.icon} {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Profil / Déconnexion */}
        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center justify-between px-2 mb-4">
            
            {/* Avatar + Nom */}
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-full bg-phytora-dark flex-shrink-0 flex items-center justify-center text-white font-bold overflow-hidden">
                {user?.avatar ? (
                  <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" />
                ) : (
                  user?.name?.charAt(0).toUpperCase()
                )}
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-bold text-gray-800 truncate">{user?.name}</p>
                <p className="text-xs text-gray-500">Agriculteur</p>
              </div>
            </div>

            {/* Icône Settings */}
            <Link 
              to="/dashboard/profile" 
              className="p-2 text-gray-400 hover:text-phytora-dark hover:bg-gray-100 rounded-lg transition-colors"
              title="Paramètres du profil"
            >
              <Settings size={18} />
            </Link>
          </div>

          <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition font-medium">
            <LogOut size={16} /> Déconnexion
          </button>
        </div>
      </aside>

      {/* --- CONTENU PRINCIPAL --- */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        
        {/* Barre supérieure avec le bouton Menu (Toujours visible) */}
        <div className="bg-white p-4 border-b border-gray-200 flex items-center justify-between z-30">
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleSidebar} 
              className="p-2 bg-gray-50 hover:bg-gray-200 rounded-lg text-gray-700 transition"
              title={isSidebarOpen ? "Cacher le menu" : "Afficher le menu"}
            >
              <Menu size={24} />
            </button>
            <h2 className="font-semibold text-gray-700 hidden sm:block">
              Espace de travail
            </h2>
          </div>
          
          <div className="text-sm text-gray-500">
            Connecté : {user?.name}
          </div>
        </div>

        {/* La page (Dashboard, Detection, etc.) */}
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}