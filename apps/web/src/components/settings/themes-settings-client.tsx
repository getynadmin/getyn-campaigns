'use client';

import { Monitor, Moon, Sun } from 'lucide-react';

import { useTheme } from '@/lib/use-theme';
import type { ThemePref } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Choice = { value: ThemePref; label: string; icon: typeof Sun };

const APP_CHOICES: Choice[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

// Sidebar 'system' means "follow whatever the app is set to."
const SIDEBAR_CHOICES: Choice[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Match app', icon: Monitor },
];

export function ThemesSettingsClient(): JSX.Element {
  const { app, sidebar, setApp, setSidebar } = useTheme();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ThemePicker
        title="App theme"
        description="Sets the colour scheme for everything except the sidebar."
        value={app}
        onChange={setApp}
        choices={APP_CHOICES}
      />
      <ThemePicker
        title="Sidebar theme"
        description="Choose a different scheme for the sidebar — handy if you like a dark navigation rail next to a light workspace."
        value={sidebar}
        onChange={setSidebar}
        choices={SIDEBAR_CHOICES}
      />
    </div>
  );
}

function ThemePicker({
  title,
  description,
  value,
  onChange,
  choices,
}: {
  title: string;
  description: string;
  value: ThemePref;
  onChange: (v: ThemePref) => void;
  choices: Choice[];
}): JSX.Element {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-5">
      <header>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </header>
      <div className="grid grid-cols-3 gap-2">
        {choices.map(({ value: v, label, icon: Icon }) => {
          const selected = v === value;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={cn(
                'group flex flex-col items-center gap-2 rounded-lg border p-3 text-xs font-medium transition-all',
                selected
                  ? 'border-primary bg-primary/5 text-foreground ring-2 ring-primary/20'
                  : 'border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground',
              )}
              aria-pressed={selected}
            >
              <span
                className={cn(
                  'grid size-9 place-items-center rounded-md',
                  selected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
                )}
              >
                <Icon className="size-4" />
              </span>
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
