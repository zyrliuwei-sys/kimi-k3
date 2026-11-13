import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Plus,
} from 'lucide-react';

import { Link } from '@/core/i18n/navigation';

import '@/styles/model-guide.css';

type GuideLink = { label: string; href: string };

export type ModelGuideContent = {
  eyebrow: string;
  title: string;
  subtitle: string;
  summary: string;
  status: string;
  updatedLabel: string;
  readingTime: string;
  contentsLabel: string;
  independentNote: string;
  primaryAction: GuideLink;
  secondaryAction: GuideLink;
  visual: { version: string; label: string; detail: string };
  facts: { value: string; label: string; note: string }[];
  sections: { id: string; label: string }[];
};

export function ModelGuide({
  content,
  updatedAt,
  children,
}: {
  content: ModelGuideContent;
  updatedAt: string;
  children: ReactNode;
}) {
  const [activeSection, setActiveSection] = useState(content.sections[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-100px 0px -60% 0px' }
    );
    for (const { id } of content.sections) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [content.sections]);

  return (
    <article className="model-guide">
      <header className="model-guide-hero">
        <div className="model-guide-hero-copy">
          <div className="model-guide-eyebrow">
            <span className="model-guide-status-dot" />
            {content.eyebrow}
          </div>
          <h1>{content.title}</h1>
          <p className="model-guide-subtitle">{content.subtitle}</p>
          <p className="model-guide-summary">{content.summary}</p>
          <div className="model-guide-actions">
            <a
              href={content.primaryAction.href}
              target="_blank"
              rel="noopener noreferrer"
              className="model-guide-button"
            >
              {content.primaryAction.label}
              <ArrowRight size={16} aria-hidden="true" />
            </a>
            <a
              href={content.secondaryAction.href}
              className="model-guide-text-link"
            >
              {content.secondaryAction.label}
              <ArrowDown size={15} aria-hidden="true" />
            </a>
          </div>
          <div className="model-guide-byline">
            <span>{content.status}</span>
            <span>
              {content.updatedLabel}{' '}
              <time dateTime={updatedAt}>{updatedAt}</time>
            </span>
            <span>{content.readingTime}</span>
          </div>
        </div>
        <div className="model-guide-orbit" aria-hidden="true">
          <div className="model-guide-orbit-kicker">{content.visual.label}</div>
          <svg viewBox="0 0 360 360" fill="none">
            <circle cx="180" cy="180" r="143" />
            {[38, 76, 112].map((radius) => (
              <ellipse key={radius} cx="180" cy="180" rx={radius} ry="143" />
            ))}
            {[44, 88, 123].map((radius) => (
              <ellipse key={radius} cx="180" cy="180" rx="143" ry={radius} />
            ))}
            <path d="M37 180h286M180 37v286" />
            <circle
              className="model-guide-orbit-axis"
              cx="180"
              cy="180"
              r="166"
              strokeDasharray="2 9"
            />
            <circle className="model-guide-orbit-node" cx="79" cy="79" r="5" />
            <circle
              className="model-guide-orbit-node"
              cx="310"
              cy="239"
              r="5"
            />
          </svg>
          <span className="model-guide-orbit-version">
            {content.visual.version}
          </span>
          <span className="model-guide-orbit-detail">
            {content.visual.detail}
          </span>
        </div>
      </header>

      <dl className="model-guide-facts">
        {content.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              <span>{fact.note}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="model-guide-layout">
        <aside className="model-guide-sidebar">
          <nav aria-label={content.contentsLabel}>
            <p className="model-guide-eyebrow">{content.contentsLabel}</p>
            <ol>
              {content.sections.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    aria-current={
                      activeSection === section.id ? 'location' : undefined
                    }
                    onClick={() => setActiveSection(section.id)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    {section.label}
                  </a>
                </li>
              ))}
            </ol>
            <p className="model-guide-independent">{content.independentNote}</p>
          </nav>
        </aside>
        <div className="model-guide-body">{children}</div>
      </div>
    </article>
  );
}

export function GuideSection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="model-guide-section">
      <div className="model-guide-section-heading">
        <span aria-hidden="true">{number}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function GuideCallout({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="model-guide-callout">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function GuidePricing({
  caption,
  columns,
  rows,
  note,
}: {
  caption: string;
  columns: string[];
  rows: { name: string; input: string; output: string; fit: string }[];
  note: ReactNode;
}) {
  return (
    <div className="model-guide-pricing">
      <div className="model-guide-table-scroll">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{row.input}</td>
                <td>{row.output}</td>
                <td>{row.fit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="model-guide-table-note">{note}</div>
    </div>
  );
}

export function GuidePrompt({
  label,
  text,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  label: string;
  text: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  );
  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timeout);
  }, [copyState]);
  return (
    <div className="model-guide-prompt">
      <div className="model-guide-prompt-header">
        <span>{label}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopyState('copied');
            } catch {
              setCopyState('failed');
            }
          }}
        >
          {copyState === 'copied' ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <Copy size={14} aria-hidden="true" />
          )}
          <span aria-live="polite">
            {copyState === 'copied'
              ? copiedLabel
              : copyState === 'failed'
                ? failedLabel
                : copyLabel}
          </span>
        </button>
      </div>
      <p>{text}</p>
    </div>
  );
}

export type GuideFaqItem = { question: string; answer: string };

export function GuideFaq({ items }: { items: GuideFaqItem[] }) {
  return (
    <div className="model-guide-faq">
      {items.map((item) => (
        <details key={item.question}>
          <summary>
            {item.question}
            <Plus size={18} aria-hidden="true" />
          </summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function GuideSources({
  title,
  note,
  items,
}: {
  title: string;
  note: string;
  items: { title: string; publisher: string; href: string }[];
}) {
  return (
    <footer className="model-guide-sources">
      <h2>{title}</h2>
      <p>{note}</p>
      <ol>
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} target="_blank" rel="noopener noreferrer">
              <span>
                {item.title}
                <small>{item.publisher}</small>
              </span>
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ol>
    </footer>
  );
}

export function GuideRelated({
  title,
  description,
  links,
}: {
  title: string;
  description: string;
  links: GuideLink[];
}) {
  return (
    <div className="model-guide-related">
      <h2>{title}</h2>
      <p>{description}</p>
      <div>
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
