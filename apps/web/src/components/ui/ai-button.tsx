'use client';

import { forwardRef } from 'react';
import { Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Gradient-border "AI" action button. Wraps a normal Button-sized
 * element in a thin animated rainbow gradient and a subtle pulsing
 * sparkles icon so AI-powered actions read differently from regular
 * CTAs. Use this everywhere we trigger a Claude/AI generation.
 *
 * Pointer events pass through the wrapper; the inner button handles
 * all clicks.
 */
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'solid' | 'outline';
  size?: 'default' | 'sm';
};

export const AiButton = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = 'solid', size = 'default', children, ...props }, ref) => {
    const sizeCls =
      size === 'sm' ? 'h-9 px-3 text-sm' : 'h-10 px-4 text-sm';
    const inner =
      variant === 'solid'
        ? 'bg-foreground text-background hover:bg-foreground/90'
        : 'bg-background text-foreground hover:bg-muted';

    return (
      <span
        className={cn(
          'ai-btn-wrap inline-flex items-center justify-center rounded-md p-[1.5px]',
          className,
        )}
      >
        <button
          ref={ref}
          {...props}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-[5px] font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60',
            sizeCls,
            inner,
          )}
        >
          <Sparkles className="ai-btn-sparkle size-4 text-violet-500" />
          {children}
        </button>
      </span>
    );
  },
);
AiButton.displayName = 'AiButton';
