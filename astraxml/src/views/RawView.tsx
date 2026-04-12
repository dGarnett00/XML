import { useAppStore } from '../store/app';
import './RawView.css';

export function RawView() {
  const { nodes, document } = useAppStore();

  if (!document) {
    return <div className="raw-view raw-view--empty"><p>No document open</p></div>;
  }

  // Build minimal XML preview from nodes (full serializer attached in Sprint 2)
  const preview = nodes
    .filter((n) => n.depth <= 3)
    .map((n) => {
      const indent = '  '.repeat(n.depth);
      if (n.nodeType === 'text') return `${indent}${n.value ?? ''}`;
      if (n.nodeType === 'comment') return `${indent}<!-- ${n.value ?? ''} -->`;
      return `${indent}<${n.name}/>`;
    })
    .slice(0, 200)
    .join('\n');

  return (
    <div className="raw-view">
      <pre className="raw-view__content">{preview}</pre>
    </div>
  );
}
