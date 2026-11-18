import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";

// Pages publiques
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Profile from "./pages/Profile";

// Layout privé
import DashboardLayout from "./layouts/DashboardLayout";

// Pages privées
import Dashboard from "./pages/Dashboard";
import Detection from "./pages/Detection";
import History from "./pages/History";
import Crops from "./pages/Crops";
import Guide from "./pages/Guide";

function PrivateRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      
      {/* Routes protégées */}
      <Route 
        path="/dashboard" 
        element={
          <PrivateRoute>
            <DashboardLayout />
          </PrivateRoute>
        } 
      >
        {/* Le "index" correspond à la page par défaut quand on va sur /dashboard */}
        <Route index element={<Dashboard />} />
        <Route path="detection" element={<Detection />} />
        <Route path="history" element={<History />} />
        <Route path="crops" element={<Crops />} />
        <Route path="guide" element={<Guide />} />
        <Route path="profile" element={<Profile />} /> 



      </Route>

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}