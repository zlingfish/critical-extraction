import { describe, expect, it } from 'vitest';
import { OPERATION_LAYOUTS, selectOperationLayout } from './operation-layouts';

describe('每局行动路线', () => {
  it('每张地图都提供至少三套出生与撤离组合', () => {
    for (const layouts of Object.values(OPERATION_LAYOUTS)) {
      expect(layouts.length).toBeGreaterThanOrEqual(3);
      for (const layout of layouts) {
        expect(Math.hypot(
          layout.spawn.x - layout.extraction.x,
          layout.spawn.z - layout.extraction.z,
        )).toBeGreaterThan(60);
      }
    }
  });

  it('同一种子可以复现同一条行动路线', () => {
    expect(selectOperationLayout('harbor', 'run-42')).toEqual(selectOperationLayout('harbor', 'run-42'));
  });

  it('不同种子能够覆盖多套路线', () => {
    const ids = new Set(Array.from({ length: 30 }, (_, seed) => selectOperationLayout('reservoir', seed).id));
    expect(ids.size).toBeGreaterThan(1);
  });
});
