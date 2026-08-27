import { createSeededRandom } from './operation-events';

export type OperationMapId = 'harbor' | 'radar' | 'refinery' | 'administration' | 'reservoir';

export interface OperationPoint {
  x: number;
  z: number;
}

export interface OperationLayout {
  id: string;
  spawn: OperationPoint;
  extraction: OperationPoint;
}

export const OPERATION_LAYOUTS: Readonly<Record<OperationMapId, readonly OperationLayout[]>> = {
  harbor: [
    { id: 'south-pier', spawn: { x: 0, z: 66 }, extraction: { x: 44, z: -70 } },
    { id: 'west-yard', spawn: { x: -46, z: 62 }, extraction: { x: 46, z: -65 } },
    { id: 'east-yard', spawn: { x: 46, z: 62 }, extraction: { x: -46, z: -65 } },
  ],
  radar: [
    { id: 'ridge-road', spawn: { x: -92, z: 58 }, extraction: { x: -92, z: -66 } },
    { id: 'east-slope', spawn: { x: -55, z: 62 }, extraction: { x: -101, z: -62 } },
    { id: 'west-slope', spawn: { x: -103, z: 60 }, extraction: { x: -50, z: -58 } },
  ],
  refinery: [
    { id: 'service-road', spawn: { x: 91, z: 62 }, extraction: { x: 94, z: -68 } },
    { id: 'west-tanks', spawn: { x: 53, z: 61 }, extraction: { x: 106, z: -62 } },
    { id: 'east-tanks', spawn: { x: 106, z: 58 }, extraction: { x: 52, z: -58 } },
  ],
  administration: [
    { id: 'north-gate', spawn: { x: 165, z: 149 }, extraction: { x: 218, z: 145 } },
    { id: 'east-to-south', spawn: { x: 215, z: 140 }, extraction: { x: 123, z: -138 } },
    { id: 'west-to-south', spawn: { x: 115, z: 140 }, extraction: { x: 207, z: -138 } },
  ],
  reservoir: [
    { id: 'west-ridge', spawn: { x: 280, z: 116 }, extraction: { x: 516, z: 102 } },
    { id: 'east-ridge', spawn: { x: 528, z: 108 }, extraction: { x: 292, z: -12 } },
    { id: 'maintenance-road', spawn: { x: 260, z: 108 }, extraction: { x: 522, z: -42 } },
  ],
};

export function selectOperationLayout(mapId: OperationMapId, seed: number | string): OperationLayout {
  const layouts = OPERATION_LAYOUTS[mapId];
  const random = createSeededRandom(`${seed}-${mapId}-layout`);
  return layouts[Math.min(layouts.length - 1, Math.floor(random() * layouts.length))];
}
