'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import type { AbTest } from '@getyn/types';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/trpc';

/**
 * A/B subject test config card. Lives inside the campaign detail's
 * Settings card. When enabled, the wizard splits 2 * testPercent of
 * the segment into the test cohort (half to each variant), waits
 * `winnerDecisionAfterMinutes`, picks the winner by `winnerMetric`,
 * sends the rest with the winner.
 *
 * Pushback #5: no statistical significance test for MVP. Pick the
 * variant with the higher metric, tie goes to A, with the
 * `minSendsPerVariant` floor.
 */
export function AbTestSettings({
  campaignId,
  currentAbTest,
  fallbackSubject,
  canEdit,
  onChange,
}: {
  campaignId: string;
  currentAbTest: AbTest | null;
  fallbackSubject: string;
  canEdit: boolean;
  onChange: () => void;
}): JSX.Element {
  const [enabled, setEnabled] = useState(currentAbTest != null);
  const [variantA, setVariantA] = useState(
    currentAbTest?.variants[0]?.subject ?? fallbackSubject,
  );
  const [variantB, setVariantB] = useState(
    currentAbTest?.variants[1]?.subject ?? '',
  );
  const [testPercent, setTestPercent] = useState(
    currentAbTest?.testPercent ?? 20,
  );
  const [winnerMetric, setWinnerMetric] = useState<'open_rate' | 'click_rate'>(
    currentAbTest?.winnerMetric ?? 'open_rate',
  );
  const [winnerDecisionAfterMinutes, setWinnerDecisionAfterMinutes] = useState(
    currentAbTest?.winnerDecisionAfterMinutes ?? 240,
  );

  const update = api.campaign.update.useMutation({
    onSuccess: () => {
      onChange();
      toast.success('A/B settings saved.');
    },
    onError: (err) => toast.error(err.message ?? 'Save failed.'),
  });

  const persist = (next: Partial<AbTest> | { disable: true }): void => {
    if ('disable' in next) {
      update.mutate({
        id: campaignId,
        patch: { settings: { abTest: null } },
      });
      return;
    }
    const merged: AbTest = {
      enabled: true,
      variants: [
        { id: 'A', subject: variantA },
        { id: 'B', subject: variantB },
      ],
      testPercent,
      winnerMetric,
      winnerDecisionAfterMinutes,
      status: currentAbTest?.status ?? 'pending',
      winnerVariantId: currentAbTest?.winnerVariantId ?? null,
      winnerDecidedAt: currentAbTest?.winnerDecidedAt ?? null,
      minSendsPerVariant: currentAbTest?.minSendsPerVariant ?? 100,
      ...next,
    };
    update.mutate({
      id: campaignId,
      patch: { settings: { abTest: merged } },
    });
  };

  if (!enabled) {
    return (
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="ab-toggle"
          checked={false}
          disabled={!canEdit}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (!e.target.checked) {
              persist({ disable: true });
            }
          }}
          className="mt-0.5"
        />
        <div className="flex-1">
          <Label htmlFor="ab-toggle" className="font-medium">
            A/B test the subject line
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Split a portion of the segment between two subjects, pick the
            winner automatically by open rate or click rate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          id="ab-toggle"
          checked
          disabled={!canEdit}
          onChange={() => {
            setEnabled(false);
            persist({ disable: true });
          }}
          className="mt-0.5"
        />
        <div className="flex-1">
          <Label htmlFor="ab-toggle" className="font-medium">
            A/B test the subject line
          </Label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 pl-7 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Subject A</Label>
          <Input
            value={variantA}
            disabled={!canEdit}
            onChange={(e) => setVariantA(e.target.value)}
            onBlur={() => persist({})}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Subject B</Label>
          <Input
            value={variantB}
            disabled={!canEdit}
            onChange={(e) => setVariantB(e.target.value)}
            onBlur={() => persist({})}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">
            Test cohort {testPercent * 2}% (split A/B)
          </Label>
          <Input
            type="range"
            min={10}
            max={45}
            step={5}
            value={testPercent}
            disabled={!canEdit}
            onChange={(e) => setTestPercent(parseInt(e.target.value, 10))}
            onBlur={() => persist({ testPercent })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Winner metric</Label>
          <Select
            value={winnerMetric}
            onValueChange={(v) => {
              setWinnerMetric(v as 'open_rate' | 'click_rate');
              persist({ winnerMetric: v as 'open_rate' | 'click_rate' });
            }}
            disabled={!canEdit}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open_rate">Open rate</SelectItem>
              <SelectItem value="click_rate">Click rate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">
            Decide winner after {Math.round(winnerDecisionAfterMinutes / 60)}h
          </Label>
          <Input
            type="range"
            min={60}
            max={2880}
            step={60}
            value={winnerDecisionAfterMinutes}
            disabled={!canEdit}
            onChange={(e) =>
              setWinnerDecisionAfterMinutes(parseInt(e.target.value, 10))
            }
            onBlur={() => persist({ winnerDecisionAfterMinutes })}
          />
          <p className="text-[11px] text-muted-foreground">
            Between 1 and 48 hours. Both variants need at least 100 sends
            for a meaningful pick — otherwise A wins by default.
          </p>
        </div>
      </div>

      {currentAbTest?.status === 'winner_selected' &&
      currentAbTest.winnerVariantId ? (
        <div className="rounded-md bg-emerald-100 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Winner: variant {currentAbTest.winnerVariantId} (decided{' '}
          {currentAbTest.winnerDecidedAt
            ? new Date(currentAbTest.winnerDecidedAt).toLocaleString()
            : '—'}
          )
        </div>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        disabled={!canEdit || update.isPending}
        onClick={() => persist({})}
      >
        Save A/B settings
      </Button>
    </div>
  );
}
