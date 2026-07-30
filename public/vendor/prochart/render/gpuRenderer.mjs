/**
 * GPU bulk-geometry renderer (hybrid CPU+GPU pipeline).
 *
 * WebGL draws the high-count rectangle geometry — candle bodies, wicks, bar
 * ticks and histogram columns — as batched triangles in a single draw call per
 * frame. Everything that needs text, dashes or antialiased curves (grid, axes,
 * line/area series, overlays, crosshair) stays on 2D canvases layered around
 * the GL canvas. Falls back cleanly to the pure-2D path when WebGL is
 * unavailable.
 */

import { parseColor } from "../core/utils.mjs";

const VERT_SRC = `
attribute vec2 a_pos;
attribute vec4 a_color;
uniform vec2 u_resolution;
varying vec4 v_color;
void main() {
  vec2 clip = (a_pos / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_color = a_color;
}`;

const FRAG_SRC = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }`;

export class GpuRenderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ok = false;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true, // takeScreenshot() composites this canvas
      powerPreference: "high-performance",
    });
    if (!gl) return;
    this.gl = gl;
    this.rendererInfo = this._readRendererInfo(gl);
    this.softwareRenderer = this._isSoftwareRenderer(this.rendererInfo);
    // A software WebGL implementation adds buffer uploads and another full
    // canvas composite without GPU acceleration. The pure Canvas2D fallback is
    // materially faster in that environment (notably Chrome with hardware
    // acceleration disabled), so fail closed before allocating GL resources.
    if (this.softwareRenderer) return;

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[prochart:gpu]", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, "a_pos");
    this.aColor = gl.getAttribLocation(prog, "a_color");
    this.uRes = gl.getUniformLocation(prog, "u_resolution");
    this.posBuf = gl.createBuffer();
    this.colBuf = gl.createBuffer();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha

    // growable CPU-side batch buffers (12 floats / 24 bytes per rect for pos, 24 color bytes)
    this._cap = 4096;
    this._pos = new Float32Array(this._cap * 12);
    this._col = new Uint8Array(this._cap * 24);
    this._nRects = 0;
    this.ok = true;
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.ok = false; });
    canvas.addEventListener("webglcontextrestored", () => { /* rebuilt next frame via new GpuRenderer by chart */ });
  }

  /** @param {WebGLRenderingContext} gl */
  _readRendererInfo(gl) {
    try {
      const extension = gl.getExtension?.("WEBGL_debug_renderer_info");
      if (extension) {
        return String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) || "");
      }
      return String(gl.getParameter?.(gl.RENDERER) || "");
    } catch {
      return "";
    }
  }

  /** @param {string} rendererInfo */
  _isSoftwareRenderer(rendererInfo) {
    return /swiftshader|software|llvmpipe|softpipe|basic render|microsoft basic/i.test(
      rendererInfo,
    );
  }

  _grow(minRects) {
    let cap = this._cap;
    while (cap < minRects) cap *= 2;
    const pos = new Float32Array(cap * 12);
    pos.set(this._pos.subarray(0, this._nRects * 12));
    const col = new Uint8Array(cap * 24);
    col.set(this._col.subarray(0, this._nRects * 24));
    this._pos = pos;
    this._col = col;
    this._cap = cap;
  }

  beginFrame(w, h) {
    if (!this.ok) return;
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._nRects = 0;
    this._w = w;
    this._h = h;
  }

  /** queue an axis-aligned rect (device pixels) */
  rect(x, y, w, h, rgba) {
    if (this._nRects >= this._cap) this._grow(this._nRects + 1);
    const p = this._pos;
    let o = this._nRects * 12;
    const x2 = x + w, y2 = y + h;
    p[o] = x; p[o + 1] = y;
    p[o + 2] = x2; p[o + 3] = y;
    p[o + 4] = x; p[o + 5] = y2;
    p[o + 6] = x; p[o + 7] = y2;
    p[o + 8] = x2; p[o + 9] = y;
    p[o + 10] = x2; p[o + 11] = y2;
    const c = this._col;
    let co = this._nRects * 24;
    const a = rgba[3] / 255;
    // premultiply
    const r = Math.round(rgba[0] * a), g = Math.round(rgba[1] * a), b = Math.round(rgba[2] * a);
    for (let v = 0; v < 6; v++) {
      c[co++] = r; c[co++] = g; c[co++] = b; c[co++] = rgba[3];
    }
    this._nRects++;
  }

  /** flush queued rects clipped to a scissor region (device px, y from top) */
  flushRegion(sx, sy, sw, sh) {
    if (!this.ok || !this._nRects) { this._nRects = 0; return; }
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this._w, this._h);
    gl.enable(gl.SCISSOR_TEST);
    // GL scissor origin is bottom-left
    gl.scissor(Math.max(0, sx | 0), Math.max(0, (this._h - sy - sh) | 0), Math.max(0, sw | 0), Math.max(0, sh | 0));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this._pos.subarray(0, this._nRects * 12), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this._col.subarray(0, this._nRects * 24), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, this._nRects * 6);
    gl.disable(gl.SCISSOR_TEST);
    this._nRects = 0;
  }
}
