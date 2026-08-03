import { bootChart, readPageOptions } from "/chart/sdk.js";
import FvgIndicator from "./indicators/fvg/FvgIndicator.js";
import LevelsIndicator from "./indicators/levels/LevelsIndicator.js";
import { registerTestingInputPanels } from "./indicators/inputPanels.js";
import { registerTestingIndicatorPresets } from "./indicators/presets.js";
import { mountTestingHelpers } from "./mountTestingHelpers.js";

registerTestingInputPanels();
registerTestingIndicatorPresets();

const pageOpts = readPageOptions();

bootChart({ ...pageOpts, indicatorDefinitions: [FvgIndicator, LevelsIndicator] })
  .then((widget) => {
    if (typeof window !== "undefined") window.__BWC_WIDGET__ = widget;
    mountTestingHelpers(widget);
  })
  .catch((err) => {
    console.error(err);
    document.getElementById("app-loader")?.classList.add("app-loader--hidden");
  });
