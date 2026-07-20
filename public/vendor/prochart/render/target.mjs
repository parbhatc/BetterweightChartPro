/** Render target passed to overlay ("primitive") renderers. */
export class RenderTarget {
  constructor(ctx, mediaW, mediaH, dpr) {
    this._ctx = ctx;
    this._mw = mediaW;
    this._mh = mediaH;
    this._dpr = dpr;
  }
  useMediaCoordinateSpace(fn) {
    const ctx = this._ctx;
    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    try {
      return fn({
        context: ctx,
        mediaSize: { width: this._mw, height: this._mh },
      });
    } finally {
      ctx.restore();
    }
  }
  useBitmapCoordinateSpace(fn) {
    const ctx = this._ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    try {
      return fn({
        context: ctx,
        mediaSize: { width: this._mw, height: this._mh },
        bitmapSize: { width: Math.round(this._mw * this._dpr), height: Math.round(this._mh * this._dpr) },
        horizontalPixelRatio: this._dpr,
        verticalPixelRatio: this._dpr,
      });
    } finally {
      ctx.restore();
    }
  }
}
