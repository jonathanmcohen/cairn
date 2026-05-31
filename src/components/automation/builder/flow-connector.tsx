'use client';

type Props = { variant?: 'default' | 'branch' };

export function FlowConnector({ variant = 'default' }: Props) {
  return (
    <div
      data-testid="flow-connector"
      aria-hidden="true"
      className={`mx-auto flex h-6 w-px items-end justify-center ${
        variant === 'branch' ? 'border-l border-dashed border-border' : 'bg-border'
      }`}
    >
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: decorative arrow; the wrapper is aria-hidden. */}
      <svg
        width="9"
        height="6"
        viewBox="0 0 9 6"
        className="translate-y-1 text-border"
        role="presentation"
      >
        <path d="M0 0 L4.5 6 L9 0 Z" fill="currentColor" />
      </svg>
    </div>
  );
}
