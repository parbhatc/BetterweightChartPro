export const PRICE_SCALE_MIN_WIDTH = 72;
export const MOBILE_TIME_SCALE_MIN_HEIGHT = 28;

/** Pure responsive rule shared by chart creation and viewport tests. */
export function responsiveAxisMinimums(width, coarse = false) {
  const mobile = Number(width) <= 768 || Boolean(coarse);
  return mobile
    ? {
        priceScaleWidth: PRICE_SCALE_MIN_WIDTH,
        timeScaleHeight: MOBILE_TIME_SCALE_MIN_HEIGHT,
      }
    : { priceScaleWidth: PRICE_SCALE_MIN_WIDTH, timeScaleHeight: 0 };
}
