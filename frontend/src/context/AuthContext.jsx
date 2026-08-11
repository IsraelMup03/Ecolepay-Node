import React, { createContext, useContext, useState, useEffect } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('ecolepay_user');
    return stored ? JSON.parse(stored) : null;
  });
  const [ecole, setEcole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('ecolepay_token');
    if (token) {
      client.get('/auth/me')
        .then((res) => {
          setUser(res.data.user);
          if (res.data.ecole) setEcole(res.data.ecole);
        })
        .catch(() => {
          localStorage.removeItem('ecolepay_token');
          localStorage.removeItem('ecolepay_user');
          setUser(null);
          setEcole(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  async function login(email, password) {
    const res = await client.post('/auth/login', { email, password });
    localStorage.setItem('ecolepay_token', res.data.token);
    localStorage.setItem('ecolepay_user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    setEcole(res.data.ecole);
    return res.data;
  }

  function logout() {
    localStorage.removeItem('ecolepay_token');
    localStorage.removeItem('ecolepay_user');
    setUser(null);
    window.location.href = '/login';
  }

  function hasPermission(perm) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    let perms = {};
    try {
      perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '{}') : (user.permissions || {});
    } catch (e) { perms = {}; }
    if (perms.tout) return true;
    return !!perms[perm];
  }

  return (
    <AuthContext.Provider value={{ user, setUser, ecole, login, logout, loading, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
