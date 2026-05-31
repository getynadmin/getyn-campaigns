import {
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

/**
 * Phase 5.7 — shared right-column marketing panel for /login + /signup.
 *
 * Server component (no client JS). Animations are CSS-only:
 *   - .auth-float on each channel tile (staggered via inline delay)
 *   - .auth-dash on the connector lines (stroke-dashoffset march)
 *   - .auth-orb on the background blur orbs
 *
 * Hidden below the `md` breakpoint by the layout wrapper — on mobile
 * the form takes the full viewport.
 */
export function AuthMarketingPanel(): JSX.Element {
  return (
    <aside className="relative isolate hidden h-screen overflow-hidden bg-gradient-to-br from-purple-700 via-violet-700 to-fuchsia-800 text-white md:flex md:flex-col md:items-center md:justify-between md:p-12">
      {/* Floating background orbs */}
      <div
        aria-hidden
        className="auth-orb pointer-events-none absolute left-[-6rem] top-[-4rem] size-72 rounded-full bg-fuchsia-400/30 blur-3xl"
        style={{ animationDelay: '0s' }}
      />
      <div
        aria-hidden
        className="auth-orb pointer-events-none absolute right-[-8rem] top-1/3 size-96 rounded-full bg-violet-300/20 blur-3xl"
        style={{ animationDelay: '-3s' }}
      />
      <div
        aria-hidden
        className="auth-orb pointer-events-none absolute bottom-[-6rem] left-1/3 size-80 rounded-full bg-purple-400/20 blur-3xl"
        style={{ animationDelay: '-6s' }}
      />

      {/* Spacer to push the centerpiece toward the middle. */}
      <div />

      <div className="relative z-10 flex flex-col items-center gap-8">
        <ChannelHub />

        <div className="max-w-md space-y-3 text-center">
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Email, WhatsApp, AI — Unified
          </h2>
          <p className="text-sm text-white/75">
            Run marketing campaigns across every channel from one platform with
            an AI copilot that helps you create faster.
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="relative z-10 grid w-full max-w-md grid-cols-3 gap-0 divide-x divide-white/15 rounded-2xl border border-white/15 bg-white/5 px-2 py-4 backdrop-blur-sm">
        <Stat label="Channels" value="5+" />
        <Stat label="Copilot" value="AI" />
        <Stat label="Faster" value="10×" />
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 px-3">
      <span className="font-display text-2xl font-semibold tracking-tight">
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-white/65">
        {label}
      </span>
    </div>
  );
}

/**
 * Hub-and-spokes: center megaphone + 4 channel tiles wired with
 * dashed connectors. Pure SVG-on-CSS-positioned tiles; no JS.
 */
function ChannelHub(): JSX.Element {
  return (
    <div className="relative h-72 w-72">
      {/* Connectors. The SVG sits behind the tiles; lines come from
          center to each corner. Path lengths set so the stroke-dash
          animation reads as a steady march. */}
      <svg
        viewBox="0 0 288 288"
        aria-hidden
        className="absolute inset-0 size-full"
        fill="none"
      >
        {/* top-left, top-right, bottom-left, bottom-right */}
        {[
          'M144 144 L48 48',
          'M144 144 L240 48',
          'M144 144 L48 240',
          'M144 144 L240 240',
        ].map((d, i) => (
          <path
            key={i}
            d={d}
            stroke="rgba(255,255,255,0.45)"
            strokeWidth="1.5"
            strokeDasharray="6 6"
            strokeLinecap="round"
            className="auth-dash"
            style={{ animationDelay: `${i * -0.4}s` }}
          />
        ))}
      </svg>

      {/* Center megaphone */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="grid size-20 place-items-center rounded-2xl bg-white/95 text-purple-700 shadow-xl shadow-purple-950/30 ring-1 ring-white/30">
          <Megaphone className="size-9" />
        </div>
      </div>

      {/* Corner tiles */}
      <CornerTile
        position="top-0 left-0"
        delay="0s"
        icon={<Mail className="size-5" />}
        label="Email"
      />
      <CornerTile
        position="top-0 right-0"
        delay="-1s"
        icon={<MessageCircle className="size-5" />}
        label="WhatsApp"
      />
      <CornerTile
        position="bottom-0 left-0"
        delay="-2s"
        icon={<MessageSquare className="size-5" />}
        label="SMS"
      />
      <CornerTile
        position="bottom-0 right-0"
        delay="-3s"
        icon={<Sparkles className="size-5" />}
        label="AI"
      />
    </div>
  );
}

function CornerTile({
  position,
  delay,
  icon,
  label,
}: {
  position: string;
  delay: string;
  icon: React.ReactNode;
  label: string;
}): JSX.Element {
  return (
    <div
      className={`absolute ${position} auth-float flex size-16 flex-col items-center justify-center gap-0.5 rounded-xl border border-white/20 bg-white/15 text-white backdrop-blur-sm`}
      style={{ animationDelay: delay }}
    >
      {icon}
      <span className="text-[9px] uppercase tracking-wide text-white/80">
        {label}
      </span>
    </div>
  );
}
