import { useAppStore, FilterCriteria } from '../store/app';
import './FilterBar.css';

const MODES: { id: FilterCriteria['mode']; label: string }[] = [
  { id: 'contains', label: 'Contains' },
  { id: 'equals',   label: 'Equals' },
  { id: 'regex',    label: 'Regex' },
];

export function FilterBar() {
  const { filter, setFilter, resetFilter, document } = useAppStore();

  if (!document) return null;

  const hasFilter = filter.tag || filter.attribute || filter.value;

  return (
    <div className="filter-bar">
      <span className="filter-bar__label">Filter</span>

      <input
        className="filter-bar__input"
        type="text"
        placeholder="Tag name…"
        value={filter.tag}
        onChange={(e) => setFilter({ tag: e.target.value })}
      />

      <input
        className="filter-bar__input"
        type="text"
        placeholder="Attribute…"
        value={filter.attribute}
        onChange={(e) => setFilter({ attribute: e.target.value })}
      />

      <input
        className="filter-bar__input"
        type="text"
        placeholder="Value…"
        value={filter.value}
        onChange={(e) => setFilter({ value: e.target.value })}
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
