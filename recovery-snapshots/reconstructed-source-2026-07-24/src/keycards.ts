import type { InventoryItem } from './types';

export type KeycardMapId = 'administration';

export interface KeycardOffer {
  mapId: KeycardMapId;
  mapName: string;
  roomName: string;
  price: number;
  item: InventoryItem;
}

export const ADMIN_SECRET_CARD_ID = 'administration-outdoor-access-card';

export const ADMIN_SECRET_CARD: InventoryItem = {
  id: ADMIN_SECRET_CARD_ID,
  name: '行政主楼档案室房卡',
  kind: 'intel',
  rarity: 'purple',
  value: 2600 * 7,
  quantity: 1,
  keyUses: 3,
  maxKeyUses: 3,
  description: '行政辖区专用房卡，可使用 3 次开启行政主楼二楼秘密档案室。',
};

export const KEYCARD_OFFERS: readonly KeycardOffer[] = [
  {
    mapId: 'administration',
    mapName: '行政辖区',
    roomName: '主楼二楼秘密档案室',
    price: 6200,
    item: ADMIN_SECRET_CARD,
  },
] as const;

export function keycardOfferForMap(mapId: string): KeycardOffer | null {
  return KEYCARD_OFFERS.find((offer) => offer.mapId === mapId) ?? null;
}
