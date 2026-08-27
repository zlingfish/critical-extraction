import { describe, expect, it } from 'vitest';
import { getThreatEscalation } from './threat-escalation';

describe('随时间增加的战场威胁', () => {
  it('非法或负数时间会回到初始阶段', () => {
    expect(getThreatEscalation(-5)).toMatchObject({ level: 0, progress: 0, label: '威胁稳定' });
    expect(getThreatEscalation(Number.NaN)).toMatchObject({ level: 0, progress: 0 });
  });

  it('在 120、240、360 秒进入新的威胁阶段', () => {
    expect(getThreatEscalation(119.9).level).toBe(0);
    expect(getThreatEscalation(120).level).toBe(1);
    expect(getThreatEscalation(240).level).toBe(2);
    expect(getThreatEscalation(360).level).toBe(3);
  });

  it('时间越久，发现、协同和火力节奏逐步增强但有上限', () => {
    const early = getThreatEscalation(10);
    const late = getThreatEscalation(420);
    expect(late.perceptionMultiplier).toBeGreaterThan(early.perceptionMultiplier);
    expect(late.coordinationMultiplier).toBeGreaterThan(early.coordinationMultiplier);
    expect(late.accuracyMultiplier).toBeGreaterThan(early.accuracyMultiplier);
    expect(late.fireDelayMultiplier).toBeLessThan(early.fireDelayMultiplier);
    expect(late.damageMultiplier).toBeLessThan(1.2);
    expect(late.progress).toBe(1);
  });
});

