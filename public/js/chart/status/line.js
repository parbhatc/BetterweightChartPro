import { getMarketStatusDetails, renderMarketStatusIcons } from "../market/status.js";
import { barPriceClass, candleValueColor, isBarUp, barChangeFromPrevClose } from "../bar/style.js";
import { precisionFromSettings } from "../timezone/list.js";
import { resolutionShortLabel } from "../resolutionFormat.js";
import { formatDisplayPrice } from "../format.js";

/** @type {WeakMap<HTMLElement, string>} */
const statusLineAppearanceKeys = new WeakMap();
/** @type {WeakMap<HTMLElement, {
 *   structureKey: string,
 *   root: Element | null,
 *   values: Map<string, HTMLElement>,
 *   coloredValues: HTMLElement[],
 *   changePair: HTMLElement | null,
 *   priceClass: string,
 *   priceColor: string,
 *   changeClass: string,
 * }>} */
const statusLineViews = new WeakMap();
/** @type {WeakMap<object, { minute: number, status: ReturnType<typeof getMarketStatusDetails> }>} */
const marketStatusBySymbol = new WeakMap();
/** @type {{ minute: number, status: ReturnType<typeof getMarketStatusDetails> } | null} */
let anonymousMarketStatus = null;

/** @deprecated use getMarketStatusDetails */
export function getMarketStatus(symbolInfo, nowMs = Date.now()) {
  const s = getMarketStatusDetails(symbolInfo, nowMs);
  return { label: s.title, open: s.open };
}

function fmtNum(n, precision = 2) {
  return formatDisplayPrice(Number(n), precision);
}

function fmtVol(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** @param {string} symbol @param {object} [symbolInfo] */
function statusLineTicker(symbol, symbolInfo) {
  if (symbolInfo?.name) return String(symbolInfo.name);
  if (symbolInfo?.ticker) {
    const t = String(symbolInfo.ticker);
    const colon = t.lastIndexOf(":");
    if (colon >= 0) return t.slice(colon + 1);
    return t;
  }
  const raw = String(symbol ?? "");
  const colon = raw.lastIndexOf(":");
  if (colon >= 0) return raw.slice(colon + 1);
  return raw;
}

/** @param {object} sl */
function resolveTitleSettings(sl) {
  const showTitle = sl.showTitle ?? sl.showSymbol ?? true;
  let titleSource = sl.titleSource;
  if (titleSource === "ticker") titleSource = "symbol";
  if (titleSource === "ticker_name") titleSource = "symbol_name";
  if (!titleSource) {
    if (sl.showSymbol && sl.showDescription) titleSource = "symbol_name";
    else if (sl.showDescription) titleSource = "name";
    else titleSource = "symbol";
  }
  return { showTitle, titleSource };
}

/** Market status changes at minute boundaries, not when the hovered candle changes. */
function cachedMarketStatus(symbolInfo) {
  const minute = Math.floor(Date.now() / 60_000);
  if (symbolInfo && typeof symbolInfo === "object") {
    const cached = marketStatusBySymbol.get(symbolInfo);
    if (cached?.minute === minute) return cached.status;
    const status = getMarketStatusDetails(symbolInfo);
    marketStatusBySymbol.set(symbolInfo, { minute, status });
    return status;
  }
  if (anonymousMarketStatus?.minute === minute) return anonymousMarketStatus.status;
  const status = getMarketStatusDetails(symbolInfo);
  anonymousMarketStatus = { minute, status };
  return status;
}

/** @param {HTMLElement | undefined} node @param {string} value */
function patchStatusText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

/**
 * @param {HTMLElement} mainEl
 * @param {string} structureKey
 * @param {string} priceClass
 * @param {string} priceColor
 * @param {string} changeClass
 */
function captureStatusLineView(mainEl, structureKey, priceClass, priceColor, changeClass) {
  /** @type {Map<string, HTMLElement>} */
  const values = new Map();
  /** @type {HTMLElement[]} */
  const coloredValues = [];
  for (const node of mainEl.querySelectorAll("[data-status-value]")) {
    if (!(node instanceof HTMLElement)) continue;
    const field = node.dataset.statusValue;
    if (field) values.set(field, node);
    if (node.dataset.statusColored === "1") coloredValues.push(node);
  }
  const changePair = mainEl.querySelector("[data-status-change-pair]");
  const view = {
    structureKey,
    root: mainEl.firstElementChild,
    values,
    coloredValues,
    changePair: changePair instanceof HTMLElement ? changePair : null,
    priceClass,
    priceColor,
    changeClass,
  };
  statusLineViews.set(mainEl, view);
  return view;
}

/** @param {HTMLElement} el @param {object} settings */
export function applyStatusLineAppearance(el, settings) {
  const sl = settings?.statusLine ?? {};
  const chartTextColor = sl.useChartTextColor
    ? String(settings?.canvas?.scalesTextColor ?? "").trim()
    : "";
  const showBackground = Boolean(sl.showBackground);
  const pct = showBackground
    ? Math.max(0, Math.min(100, Number(sl.backgroundOpacity) || 0))
    : 0;
  const appearanceKey = `${showBackground ? 1 : 0}|${pct}|${chartTextColor}`;
  if (statusLineAppearanceKeys.get(el) === appearanceKey) return;
  statusLineAppearanceKeys.set(el, appearanceKey);

  el.style.boxShadow = "none";
  if (chartTextColor) {
    el.style.setProperty("--tv-text", chartTextColor);
    el.style.setProperty("--tv-muted", chartTextColor);
  } else {
    el.style.removeProperty("--tv-text");
    el.style.removeProperty("--tv-muted");
  }
  if (showBackground) {
    const mix = Math.round(100 - pct * 0.82);
    el.style.setProperty("--status-line-bg", `color-mix(in srgb, var(--tv-bg) ${mix}%, transparent)`);
    el.style.setProperty(
      "--status-line-border-color",
      `color-mix(in srgb, var(--tv-border) ${50 + pct * 0.25}%, transparent)`,
    );
    el.style.removeProperty("background");
    el.style.removeProperty("border");
    el.style.removeProperty("backdrop-filter");
    el.classList.add("status-line--bg");
  } else {
    el.style.removeProperty("--status-line-bg");
    el.style.removeProperty("--status-line-border-color");
    el.style.background = "transparent";
    el.style.border = "none";
    el.style.backdropFilter = "none";
    el.classList.remove("status-line--bg");
  }
}

/**
 * @param {HTMLElement} el
 * @param {object} opts
 * @param {string} opts.symbol
 * @param {string} [opts.resolution]
 * @param {object} [opts.symbolInfo]
 * @param {object} [opts.bar]
 * @param {object} [opts.prevBar]
 * @param {object} opts.settings
 */
export function renderStatusLine(el, opts) {
  const { symbol, symbolInfo, resolution, bar, prevBar, settings } = opts;
  const sl = settings.statusLine ?? {};
  const precision = precisionFromSettings(settings, symbolInfo);

  let mainEl = el.querySelector(".status-line__main");
  let studiesEl = el.querySelector(".status-line__studies");
  if (!mainEl) {
    const preservedStudies = el.querySelector(".status-line__studies");
    el.textContent = "";
    mainEl = document.createElement("div");
    mainEl.className = "status-line__main";
    studiesEl = preservedStudies ?? document.createElement("div");
    studiesEl.className = "status-line__studies";
    el.append(mainEl, studiesEl);
  } else if (!studiesEl) {
    studiesEl = document.createElement("div");
    studiesEl.className = "status-line__studies";
    el.appendChild(studiesEl);
  } else if (!el.contains(studiesEl)) {
    el.appendChild(studiesEl);
  }

  if (!bar) {
    if (mainEl.hasChildNodes()) mainEl.replaceChildren();
    statusLineViews.delete(mainEl);
    return;
  }

  const market = cachedMarketStatus(symbolInfo);
  const { showTitle, titleSource } = resolveTitleSettings(sl);
  const ticker = statusLineTicker(symbol, symbolInfo);

  let head = "";
  if (showTitle) {
    if (titleSource === "symbol") {
      head += `<span class="status-line__ticker">${ticker}</span>`;
    } else if (titleSource === "name") {
      if (symbolInfo?.description) {
        head += `<span class="status-line__name">${symbolInfo.description}</span>`;
      } else {
        head += `<span class="status-line__ticker">${ticker}</span>`;
      }
    } else if (titleSource === "symbol_name") {
      head += `<span class="status-line__ticker">${ticker}</span>`;
      if (symbolInfo?.description) {
        head += `<span class="status-line__dot status-line__dot--before-name" aria-hidden="true">·</span><span class="status-line__name">${symbolInfo.description}</span>`;
      }
    } else {
      head += `<span class="status-line__ticker">${ticker}</span>`;
    }
    if (resolution) {
      head += `<span class="status-line__dot" aria-hidden="true">·</span><span class="status-line__res">${resolutionShortLabel(resolution)}</span>`;
    }
    if (symbolInfo?.exchange) {
      head += `<span class="status-line__dot" aria-hidden="true">·</span><span class="status-line__exch">${symbolInfo.exchange}</span>`;
    }
  }

  const sym = settings.symbol ?? {};
  const colorOnPrev = Boolean(sym.colorBarsOnPrevClose);
  const barUp = isBarUp(bar, prevBar, colorOnPrev);
  const priceCls = barPriceClass(barUp);
  const priceColor = sl.useChartTextColor
    ? (settings.canvas?.scalesTextColor ?? candleValueColor(sym, barUp))
    : candleValueColor(sym, barUp);

  const formatted = {
    open: sl.showOHLC ? fmtNum(bar.open, precision) : "",
    high: sl.showOHLC ? fmtNum(bar.high, precision) : "",
    low: sl.showOHLC ? fmtNum(bar.low, precision) : "",
    close: sl.showOHLC ? fmtNum(bar.close, precision) : "",
    volume: sl.showVolume !== false ? fmtVol(bar.volume) : "",
    change: "",
  };
  let changeClass = "";
  if (sl.showBarChange) {
    const { change: barChg, pct: barPct } = barChangeFromPrevClose(bar, prevBar);
    const sign = barChg >= 0 ? "+" : "−";
    const pctSign = barPct >= 0 ? "+" : "−";
    formatted.change = `${sign}${fmtNum(Math.abs(barChg), precision)} (${pctSign}${Math.abs(barPct).toFixed(2)}%)`;
    changeClass = `status-line__chg--${barUp ? "up" : "down"}`;
  }

  const marketStructure = sl.showMarketStatus
    ? `${market.open ? 1 : 0}|${market.delayed ? 1 : 0}|${market.delayMinutes}|${market.title}`
    : "";
  const structureKey = [
    head,
    marketStructure,
    sl.showOHLC ? 1 : 0,
    sl.showBarChange ? 1 : 0,
    sl.showVolume !== false ? 1 : 0,
  ].join("||");

  let view = statusLineViews.get(mainEl);
  if (
    !view ||
    view.structureKey !== structureKey ||
    view.root !== mainEl.firstElementChild
  ) {
    const pair = (
      lbl,
      val,
      field,
      { colored = false, extraPairCls = "", minor = false } = {},
    ) => {
      const minorCls = minor ? " status-line__pair--minor" : "";
      const pairCls = extraPairCls
        ? ` status-line__pair ${extraPairCls}${minorCls}`
        : ` status-line__pair${minorCls}`;
      const fieldAttr = field ? ` data-status-value="${field}"` : "";
      const coloredAttr = colored ? ' data-status-colored="1"' : "";
      const valHtml = colored
        ? `<span class="status-line__val ${priceCls}" style="color:${priceColor}"${fieldAttr}${coloredAttr}>${val}</span>`
        : `<span class="status-line__val"${fieldAttr}>${val}</span>`;
      return `<span class="${pairCls.trim()}"><span class="status-line__lbl">${lbl}</span>${valHtml}</span>`;
    };

    const metaParts = [];
    if (head) metaParts.push(`<span class="status-line__head">${head}</span>`);
    if (sl.showMarketStatus) metaParts.push(renderMarketStatusIcons(market));

    const valueParts = [];
    if (sl.showOHLC) {
      valueParts.push(
        pair("O", formatted.open, "open", { colored: true, minor: true }),
        pair("H", formatted.high, "high", { colored: true, minor: true }),
        pair("L", formatted.low, "low", { colored: true, minor: true }),
        pair("C", formatted.close, "close", { colored: true }),
      );
    }
    if (sl.showBarChange) {
      valueParts.push(
        `<span class="status-line__pair status-line__chg ${changeClass}" data-status-change-pair="1"><span class="status-line__val ${priceCls}" style="color:${priceColor}" data-status-value="change" data-status-colored="1">${formatted.change}</span></span>`,
      );
    }
    if (sl.showVolume !== false) {
      valueParts.push(
        pair("Vol", formatted.volume, "volume", {
          colored: true,
          extraPairCls: "status-line__vol",
        }),
      );
    }

    let html = "";
    if (metaParts.length || valueParts.length) {
      const meta = metaParts.length
        ? `<div class="status-line__meta">${metaParts.join("")}</div>`
        : "";
      const values = valueParts.length
        ? `<div class="status-line__values">${valueParts.join("")}</div>`
        : "";
      html = `<div class="status-line__item status-line__item--series"><div class="status-line__flow">${meta}${values}</div></div>`;
    }
    mainEl.innerHTML = html;
    view = captureStatusLineView(mainEl, structureKey, priceCls, priceColor, changeClass);
  } else {
    patchStatusText(view.values.get("open"), formatted.open);
    patchStatusText(view.values.get("high"), formatted.high);
    patchStatusText(view.values.get("low"), formatted.low);
    patchStatusText(view.values.get("close"), formatted.close);
    patchStatusText(view.values.get("change"), formatted.change);
    patchStatusText(view.values.get("volume"), formatted.volume);

    if (view.priceClass !== priceCls || view.priceColor !== priceColor) {
      const valueClass = `status-line__val ${priceCls}`;
      for (const value of view.coloredValues) {
        if (value.className !== valueClass) value.className = valueClass;
        if (value.style.color !== priceColor) value.style.color = priceColor;
      }
      view.priceClass = priceCls;
      view.priceColor = priceColor;
    }
    if (view.changePair && view.changeClass !== changeClass) {
      view.changePair.className = `status-line__pair status-line__chg ${changeClass}`;
      view.changeClass = changeClass;
    }
  }

  applyStatusLineAppearance(el, settings);
}
