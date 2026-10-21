import type { ReactNode } from 'react';
import type { Severity } from '../types';

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[10px] border border-line bg-panel p-4 ${className}`}>
      {title && (
        <h3 className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
          {title}
        </h3>
      )}
      {children}
    </section>
  );
}

const SEVERITY_STYLES: Record<Severity, string> = {
  p0: 'bg-p0/15 text-p0',
  p1: 'bg-p1/15 text-p1',
  p2: 'bg-p2/15 text-p2',
  p3: 'bg-p3/20 text-p3',
};

export function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span
      className={`rounded px-1.5 py-px font-mono text-[10px] font-semibold ${SEVERITY_STYLES[severity]}`}
    >
      {severity}
    </span>
  );
}

type PillTone = 'neutral' | 'human' | 'inject' | 'money' | 'danger';

const PILL_TONES: Record<PillTone, string> = {
  neutral: 'border-line text-muted',
  human: 'border-hold/40 text-hold',
  inject: 'border-inject/40 text-inject',
  money: 'border-money/40 text-money',
  danger: 'border-danger/40 text-danger',
};

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={`rounded-full border px-1.5 py-px text-[10px] ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Key/value row used for the fact lists. Values are monospace; keys are not. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-hairline py-1.5 text-xs first:border-t-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-mono break-all text-body">{children}</span>
    </div>
  );
}

type BannerTone = 'inject' | 'human' | 'degraded';

const BANNER_TONES: Record<BannerTone, string> = {
  inject: 'border-inject/35 bg-inject/10 text-inject',
  human: 'border-hold/35 bg-hold/10 text-hold',
  degraded: 'border-danger/35 bg-danger/10 text-danger',
};

export function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: BannerTone;
  icon: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`mb-3 flex gap-2.5 rounded-lg border p-3 text-[12.5px] ${BANNER_TONES[tone]}`}>
      <span aria-hidden className="shrink-0 leading-snug">
        {icon}
      </span>
      <div>
        <strong className="block font-semibold">{title}</strong>
        {children && <span className="opacity-85">{children}</span>}
      </div>
    </div>
  );
}
