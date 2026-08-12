import React, { createContext, useContext, useState, useEffect } from 'react';

const AnneeContext = createContext(null);

export function AnneeProvider({ children }) {
  const [viewingAnnee, setViewingAnnee] = useState(() => sessionStorage.getItem('ecolepay_viewing_annee') || null);

  useEffect(() => {
    if (viewingAnnee) sessionStorage.setItem('ecolepay_viewing_annee', viewingAnnee);
    else sessionStorage.removeItem('ecolepay_viewing_annee');
  }, [viewingAnnee]);

  return (
    <AnneeContext.Provider value={{ viewingAnnee, setViewingAnnee }}>
      {children}
    </AnneeContext.Provider>
  );
}

export function useAnnee() {
  return useContext(AnneeContext);
}
