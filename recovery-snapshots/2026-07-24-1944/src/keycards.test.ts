import { describe, expect, it } from 'vitest';
import { ADMIN_SECRET_CARD_ID, KEYCARD_OFFERS, keycardOfferForMap } from './keycards';

describe('分析处房卡目录', () => {
  it('行政辖区房卡有明确的隐藏门和使用次数', () => {
    const offer = keycardOfferForMap('administration');
    expect(offer?.item.id).toBe(ADMIN_SECRET_CARD_ID);
    expect(offer?.roomName).toContain('秘密档案室');
    expect(offer?.item.keyUses).toBe(3);
    expect(offer?.price).toBeGreaterThan(offer?.item.value ?? 0);
  });

  it('不会为尚无隐藏门的地图出售无效房卡', () => {
    expect(keycardOfferForMap('harbor')).toBeNull();
    expect(KEYCARD_OFFERS).toHaveLength(1);
  });
});
