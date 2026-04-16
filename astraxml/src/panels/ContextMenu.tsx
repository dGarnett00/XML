import { useEffect, useRef, useCallback } from 'react';
import './ContextMenu.css';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to keep menu in viewport
  const adjustedPos = useCallback(() => {
    if (!menuRef.current) return { x, y };
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: x + rect.width > vw ? Math.max(0, vw - rect.width - 4) : x,
      y: y + rect.height > vh ? Math.max(0, vh - rect.height - 4) : y,
    };
  }, [x, y]);

  useEffect(() => {
    if (menuRef.current) {
      const pos = adjustedPos();
      menuRef.current.style.left = `${pos.x}px`;
      menuRef.current.style.top = `${pos.y}px`;
    }
  }, [adjustedPos]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div className="context-menu" ref={menuRef} style={{ left: x, top: y }}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu__separator" />
        ) : (
          <button
            key={i}
            className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}${item.disabled ? ' context-menu__item--disabled' : ''}`}
            onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }}
            disabled={item.disabled}
          >
            {item.icon && <span className="context-menu__icon">{item.icon}</span>}
            <span className="context-menu__label">{item.label}</span>
            {item.shortcut && <span className="context-menu__shortcut">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
}
