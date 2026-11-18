import { createContext, useState, useEffect, useContext } from "react";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("phytora_user");
    if (storedUser) setUser(JSON.parse(storedUser));
  }, []);

  const login = (email) => {
    const fakeUser = { 
      email, 
      name: email.split("@")[0],
      avatar: null // On ajoute un champ pour la photo
    };
    setUser(fakeUser);
    localStorage.setItem("phytora_user", JSON.stringify(fakeUser));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("phytora_user");
  };

  // Nouvelle fonction pour mettre à jour le profil
  const updateUser = (newData) => {
    const updatedUser = { ...user, ...newData };
    setUser(updatedUser);
    localStorage.setItem("phytora_user", JSON.stringify(updatedUser));
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);