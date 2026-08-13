import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Bouton "Gérer" + menu déroulant rendu en portal (document.body) pour ne jamais
// être coupé par l'overflow:hidden des cartes/tableaux qui le contiennent.
export default function RowMenu({ children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  function openMenu() {
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.right });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onScrollOrResize() { setOpen(false); }
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} type="button" className="btn btn-outline btn-sm" onClick={() => (open ? setOpen(false) : openMenu())}>
        <i className="ph ph-dots-three-vertical"></i> Gérer
      </button>
      {open && createPortal(
        <div ref={menuRef} className="row-menu" style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>,
        document.body
      )}
    </>
  );
}
