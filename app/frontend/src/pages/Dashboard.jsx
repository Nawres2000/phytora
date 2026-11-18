import { useAuth } from "../context/AuthContext";
import { ScanLine, CheckCircle, AlertTriangle, Calendar } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();

  // Fausses statistiques pour l'instant (on les rendra dynamiques plus tard)
  const stats = [
    { label: "Analyses totales", value: "24", icon: <ScanLine className="text-phytora-dark" />, bg: "bg-phytora-light/10" },
    { label: "Plantes saines", value: "18", icon: <CheckCircle className="text-green-500" />, bg: "bg-green-50" },
    { label: "Maladies détectées", value: "6", icon: <AlertTriangle className="text-orange-500" />, bg: "bg-orange-50" },
    { label: "Analyses récentes", value: "12", icon: <Calendar className="text-blue-500" />, bg: "bg-blue-50" },
  ];

  return (
    <div className="p-8 md:p-12">
      <header className="mb-10">
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">
          Bonjour, {user?.name} ! 👋
        </h1>
        <p className="text-gray-500">Voici ce qui se passe dans vos cultures aujourd'hui.</p>
      </header>

      {/* Cartes de statistiques */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <div key={index} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${stat.bg}`}>
              {stat.icon}
            </div>
            <div>
              <p className="text-4xl font-bold text-gray-800 mb-1">{stat.value}</p>
              <p className="text-sm font-medium text-gray-500">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Section d'action rapide */}
      <div className="mt-10 bg-gradient-to-r from-phytora-dark to-phytora-mid rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Prêt à analyser une nouvelle image ?</h2>
          <p className="text-white/80">Utilisez notre outil d'IA pour détecter les maladies ou les mauvaises herbes.</p>
        </div>
        <a href="/dashboard/detection" className="mt-6 md:mt-0 px-6 py-3 bg-white text-phytora-dark font-bold rounded-xl hover:bg-gray-100 transition shadow-lg">
          Lancer une analyse
        </a>
      </div>
    </div>
  );
}