import test from "node:test";
import assert from "node:assert/strict";

import { GpuRenderer } from "../public/vendor/prochart/render/gpuRenderer.mjs";

test("software WebGL falls back to the faster Canvas2D renderer", () => {
  const renderer = new GpuRenderer({
    getContext() {
      return {
        RENDERER: 0x1f01,
        getExtension(name) {
          return name === "WEBGL_debug_renderer_info"
            ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
            : null;
        },
        getParameter() {
          return "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)";
        },
      };
    },
  });

  assert.equal(renderer.softwareRenderer, true);
  assert.equal(renderer.ok, false);
});
