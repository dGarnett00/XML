import { useState, useEffect, useRef } from 'react';
import { useAppStore, FilterCriteria } from '../store/app';
import './FilterBar.css';

const MODES: { id: FilterCriteria['mode']; label: string }[] = [
  { id: 'contains', label: 'Contains' },
  { id: 'equals',   label: 'Equals' },
  { id: 'regex',    label: 'Regex' },
];

export function FilterBar() {
  const filter = useAppStore((s) => s.filter);
  const setFilter = useAppStore((s) => s.setFilter);
  const resetFilter = useAppStore((s) => s.resetFilter);
  const document = useAppStore((s) => s.document);

  const [localTag, setLocalTag] = useState(filter.tag);
  const [localAttribute, setLocalAttribute] = useState(filter.attribute);
  const [localValue, setLocalValue] = useState(filter.value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setFilter({ tag: localTag, attribute: localAttribute, value: localValue });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [localTag, localAttribute, localValue, setFilter]);

  // Sync local state when filter is reset externally
  useEffect(() => {
    if (!filter.tag && !filter.attribute && !filter.value) {
      setLocalTag('');
      setLocalAttribute('');
      setLocalValue('');
    }
  }, [filter.tag, filter.attribute, filter.value]);

  if (!document) return null;

  const hasFilter = localTag || localAttribute || localValue;

  return (
    <div className="filter-bar">
      <span className="filter-bar__label">Filter</span>

      <input
        className="filter-bar__input"
        type="text"
        placeholder="Tag name…"
        value={localTag}
        onChange={(e) => setLocalTag(e.target.value)}
      />

      <input
        className="filter-bar__input"
        type="text"
        placeholder="Attribute…"
        value={localAttribute}
        onChange={(e) => setLocalAttribute(e.target.value)}
      />

      <input
        className="filter-bar__input"
        type="text"
        placeholder="Value…"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
      />

      <div className="filter-bar__modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`filter-bar__mode${filter.mode === m.id ? ' active' : ''}`}
            onClick={() => setFilter({ mode: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>

      {hasFilter && (
        <button className="filter-bar__clear" onClick={resetFilter}>
          ✕ Clear
        </button>
      )}
    </div>
  );
}
