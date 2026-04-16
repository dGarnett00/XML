import { useEffect, useState } from 'react';
import { useAppStore } from '../store/app';
import { invoke } from '../lib/tauri';
import './RawView.css';

export function RawView() {
  const { document, nodes } = useAppStore();
  const [xml, setXml] = useState('');
  const [loading, setLoading] = useState(false);

  // Re-serialize whenever the nodes array or document changes
  useEffect(() => {
    if (!document) { setXml(''); return; }
    let cancelled = false;
    setLoading(true);
    invoke<string>('serialize_document', { documentId: document.id })
      .then((result) => { if (!cancelled) setXml(result); })
      .catch((e) => { if (!cancelled) setXml(`<!-- Serialization error: ${e} -->`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [document?.id, nodes]);

  if (!document) {
    return <div className="raw-view raw-view--empty"><p>No document open</p></div>;
  }

  return (
    <div className="raw-view">
      {loading && <div className="raw-view__loading">Serializing…</div>}
      <pre className="raw-view__content">{syntaxHighlight(xml)}</pre>
    </div>
  );
}

function syntaxHighlight(xml: string) {
  // Split into lines and return JSX with basic syntax coloring
  const lines = xml.split('\n');
  return lines.map((line, i) => (
    <div key={i} className="raw-view__line">
      <span className="raw-view__line-num">{i + 1}</span>
      <HighlightedLine text={line} />
    </div>
  ));
}

function HighlightedLine({ text }: { text: string }) {
  // Simple regex-based XML syntax highlighting
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Comment
    const commentMatch = remaining.match(/^(<!--[\s\S]*?-->)/);
    if (commentMatch) {
      parts.push(<span key={key++} className="raw-hl--comment">{commentMatch[1]}</span>);
      remaining = remaining.slice(commentMatch[1].length);
      continue;
    }

    // Tag (opening/closing/self-closing)
    const tagMatch = remaining.match(/^(<\/?[\w:.-]+)/);
    if (tagMatch) {
      parts.push(<span key={key++} className="raw-hl--tag">{tagMatch[1]}</span>);
      remaining = remaining.slice(tagMatch[1].length);

      // Parse attributes inside the tag
      while (remaining.length > 0) {
        // Attribute
        const attrMatch = remaining.match(/^(\s+)([\w:.-]+)(=)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/);
        if (attrMatch) {
          parts.push(<span key={key++}>{attrMatch[1]}</span>);
          parts.push(<span key={key++} className="raw-hl--attr">{attrMatch[2]}</span>);
          parts.push(<span key={key++}>{attrMatch[3]}</span>);
          parts.push(<span key={key++} className="raw-hl--value">{attrMatch[4]}</span>);
          remaining = remaining.slice(attrMatch[0].length);
          continue;
        }
        // End of tag
        const endMatch = remaining.match(/^(\s*\/?>)/);
        if (endMatch) {
          parts.push(<span key={key++} className="raw-hl--tag">{endMatch[1]}</span>);
          remaining = remaining.slice(endMatch[1].length);
          break;
        }
        // Whitespace or other
        parts.push(<span key={key++}>{remaining[0]}</span>);
        remaining = remaining.slice(1);
      }
      continue;
    }

    // Closing bracket for end tags
    const closeMatch = remaining.match(/^(<\/[\w:.-]+>)/);
    if (closeMatch) {
      parts.push(<span key={key++} className="raw-hl--tag">{closeMatch[1]}</span>);
      remaining = remaining.slice(closeMatch[1].length);
      continue;
    }

    // XML declaration
    const declMatch = remaining.match(/^(<\?[\s\S]*?\?>)/);
    if (declMatch) {
      parts.push(<span key={key++} className="raw-hl--decl">{declMatch[1]}</span>);
      remaining = remaining.slice(declMatch[1].length);
      continue;
    }

    // Plain text
    const textMatch = remaining.match(/^([^<]+)/);
    if (textMatch) {
      parts.push(<span key={key++} className="raw-hl--text">{textMatch[1]}</span>);
      remaining = remaining.slice(textMatch[1].length);
      continue;
    }

    // Fallback
    parts.push(<span key={key++}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return <span>{parts}</span>;
}
