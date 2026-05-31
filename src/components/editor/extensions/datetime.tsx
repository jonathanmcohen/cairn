'use client';

import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { DateTimeNode } from '@/components/editor/blocks/datetime-node';
import { DateField } from '@/components/ui/date-field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DEFAULT_DISPLAY_FORMAT, formatForViewer, parseInput } from '@/lib/datetime/format';

/**
 * Available IANA zones for the picker. Uses the ECMAScript-2024
 * `Intl.supportedValuesOf('timeZone')` when available (Node 22 + modern
 * browsers); falls back to a hand-picked compact list. Computed lazily.
 */
function listZones(): string[] {
  const intlAny = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intlAny.supportedValuesOf === 'function') {
    try {
      return intlAny.supportedValuesOf('timeZone');
    } catch {
      // fall through
    }
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Paris',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Asia/Kolkata',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}

type DateTimeAttrs = { iso: string; tz: string; display_format: string };

export function DateTimeView(props: {
  node: { attrs: DateTimeAttrs };
  updateAttributes?: (attrs: Partial<DateTimeAttrs>) => void;
  viewerTz?: string;
}): React.JSX.Element {
  const { node, updateAttributes, viewerTz } = props;
  const tz =
    viewerTz ??
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat
      ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
      : 'UTC');
  const fmt = node.attrs.display_format || DEFAULT_DISPLAY_FORMAT;
  const formatted = useMemo(
    () => formatForViewer(node.attrs.iso, node.attrs.tz, fmt, tz),
    [node.attrs.iso, node.attrs.tz, fmt, tz],
  );

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(node.attrs.iso.slice(0, 10));
  const [time, setTime] = useState(node.attrs.iso.slice(11, 16));
  const [zone, setZone] = useState(node.attrs.tz);
  const zones = useMemo(listZones, []);

  function commit(): void {
    if (!updateAttributes) {
      setOpen(false);
      return;
    }
    try {
      const iso = parseInput({ date, time, tz: zone });
      updateAttributes({ iso, tz: zone });
      setOpen(false);
    } catch {
      // Invalid input — leave the node unchanged.
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="inline-flex items-baseline gap-1 underline decoration-dotted cursor-pointer bg-transparent border-0 p-0 text-inherit font-inherit"
        aria-label={`${formatted} (original timezone ${node.attrs.tz})`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <time dateTime={node.attrs.iso} className="inline">
          {formatted}
        </time>
        <span className="text-xs text-muted-foreground">({node.attrs.tz})</span>
      </button>
      {open ? (
        <span
          className="absolute z-50 mt-1 left-0 top-full w-72 space-y-2 rounded-md border bg-popover p-3 text-popover-foreground shadow-md"
          role="dialog"
          aria-label="Edit date/time"
        >
          <DateField label="Date" value={date} onChange={(iso) => setDate(iso)} />
          <label className="block text-xs" htmlFor="dt-time">
            Time
            <Input
              id="dt-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="mt-1 block w-full"
            />
          </label>
          <div className="block text-xs">
            <span className="block">Timezone</span>
            <Select value={zone} onValueChange={(next) => setZone(next)}>
              <SelectTrigger aria-label="Timezone" className="mt-1 w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            onClick={commit}
            className="block w-full rounded bg-primary px-2 py-1 text-primary-foreground"
          >
            Apply
          </button>
        </span>
      ) : null}
    </span>
  );
}

function DateTimeNodeView(props: ReactNodeViewProps): React.JSX.Element {
  return (
    <NodeViewWrapper as="span">
      <DateTimeView
        node={{ attrs: props.node.attrs as DateTimeAttrs }}
        updateAttributes={(attrs) => props.updateAttributes(attrs)}
      />
    </NodeViewWrapper>
  );
}

const DateTimeExtension = DateTimeNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DateTimeNodeView);
  },
});

export default DateTimeExtension;
