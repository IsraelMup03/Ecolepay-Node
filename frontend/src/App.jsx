import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute, AdminRoute, PermissionRoute } from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import ChangerMotDePasse from './pages/ChangerMotDePasse.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Caisse from './pages/Caisse.jsx';
import Eleves from './pages/Eleves.jsx';
import EleveDetail from './pages/EleveDetail.jsx';
import Classes from './pages/Classes.jsx';
import ClasseDetail from './pages/ClasseDetail.jsx';
import Paiements from './pages/Paiements.jsx';
import Recu from './pages/Recu.jsx';
import RecuVerify from './pages/RecuVerify.jsx';
import Remboursements from './pages/Remboursements.jsx';
import Promotion from './pages/Promotion.jsx';
import Rapports from './pages/Rapports.jsx';
import Utilisateurs from './pages/Utilisateurs.jsx';
import Parametres from './pages/Parametres.jsx';
import Corbeille from './pages/Corbeille.jsx';
import Logs from './pages/Logs.jsx';
import Profil from './pages/Profil.jsx';

function Page({ children, perm, admin }) {
  const content = (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
  if (admin) {
    return (
      <ProtectedRoute>
        <Layout><AdminRoute>{children}</AdminRoute></Layout>
      </ProtectedRoute>
    );
  }
  if (perm) {
    return (
      <ProtectedRoute>
        <Layout><PermissionRoute perm={perm}>{children}</PermissionRoute></Layout>
      </ProtectedRoute>
    );
  }
  return content;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/changer-mot-de-passe" element={<ChangerMotDePasse />} />
      <Route path="/recu/:id" element={<ProtectedRoute><Recu /></ProtectedRoute>} />
      <Route path="/recu/:id/verify" element={<RecuVerify />} />

      <Route path="/" element={<Page><Dashboard /></Page>} />
      <Route path="/caisse" element={<Page perm="paiements"><Caisse /></Page>} />
      <Route path="/eleves" element={<Page perm="eleves"><Eleves /></Page>} />
      <Route path="/eleves/:id" element={<Page perm="eleves"><EleveDetail /></Page>} />
      <Route path="/classes" element={<Page perm="classes"><Classes /></Page>} />
      <Route path="/classes/:id" element={<Page perm="classes"><ClasseDetail /></Page>} />
      <Route path="/paiements" element={<Page><Paiements /></Page>} />
      <Route path="/remboursements" element={<Page perm="remboursements"><Remboursements /></Page>} />
      <Route path="/promotion" element={<Page perm="promotion"><Promotion /></Page>} />
      <Route path="/rapports" element={<Page perm="rapports"><Rapports /></Page>} />
      <Route path="/utilisateurs" element={<Page admin><Utilisateurs /></Page>} />
      <Route path="/parametres" element={<Page perm="parametres"><Parametres /></Page>} />
      <Route path="/corbeille" element={<Page admin><Corbeille /></Page>} />
      <Route path="/logs" element={<Page admin><Logs /></Page>} />
      <Route path="/profil" element={<Page><Profil /></Page>} />

      <Route path="*" element={<Page><Dashboard /></Page>} />
    </Routes>
  );
}
