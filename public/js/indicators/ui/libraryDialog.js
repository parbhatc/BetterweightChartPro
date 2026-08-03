import { listIndicators } from "../catalog.js";
import { ICON_CLEAR, ICON_CLOSE, ICON_SEARCH } from "./icons.js";
import {
  loadIndicatorFavorites,
  toggleIndicatorFavorite,
  isIndicatorFavorite,
  STAR_FILLED,
  STAR_OUTLINE,
} from "./favorites.js";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

/**
 * @param {object} opts
 * @param {(defId: string) => void} opts.onSelect
 * @param {(spec: { title: string, formula: string, color: string, placement: "chart"|"pane" }) => string} [opts.onCreate]
 * @param {() => void} [opts.onFavoritesChange]
 */
export function createIndicatorsLibraryDialog(opts) {
  const { onSelect, onCreate, onFavoritesChange } = opts;

  const root = document.createElement("div");
  root.className = "tv-ind-lib";
  root.hidden = true;
  root.innerHTML = `<div class="tv-ind-lib__backdrop" data-backdrop></div>
<div class="tv-ind-lib__dialog" role="dialog" aria-modal="true" aria-labelledby="tv-ind-lib-title" data-name="indicators-dialog">
  <div class="tv-ind-lib__header">
    <h2 class="tv-ind-lib__title" id="tv-ind-lib-title">Indicators</h2>
    <button type="button" class="tv-ind-lib__close" data-close aria-label="Close menu">${ICON_CLOSE}</button>
  </div>
  <div class="tv-ind-lib__search-wrap">
    <span class="tv-ind-lib__search-icon">${ICON_SEARCH}</span>
    <input type="text" class="tv-ind-lib__search" role="searchbox" placeholder="Search indicators" autocomplete="off" data-search />
    <div class="tv-ind-lib__search-actions">
      <button type="button" class="tv-ind-lib__fav-filter" data-fav-filter aria-pressed="false" aria-label="Show favorites only" title="Favorites">${STAR_OUTLINE}</button>
      <button type="button" class="tv-ind-lib__clear" data-clear aria-label="Clear" title="Clear" hidden>${ICON_CLEAR}</button>
    </div>
  </div>
  <div class="tv-ind-lib__create-row" data-library-create-row>
    <button type="button" class="tv-ind-lib__create-btn" data-open-builder>
      <span class="tv-ind-lib__create-plus" aria-hidden="true">+</span>
      Create custom indicator
    </button>
  </div>
  <div class="tv-ind-lib__body" data-library-view>
    <div class="tv-ind-lib__list" role="listbox" data-list></div>
  </div>
  <form class="tv-ind-builder" data-builder hidden>
    <div class="tv-ind-builder__intro">
      <button type="button" class="tv-ind-builder__back" data-builder-back aria-label="Back to indicators">&larr;</button>
      <div><strong>Build an indicator</strong><span>Combine market data and calculations with a formula.</span></div>
    </div>
    <label class="tv-ind-builder__field">Name
      <input name="title" maxlength="60" placeholder="My momentum" required />
    </label>
    <label class="tv-ind-builder__field">Formula
      <textarea name="formula" maxlength="500" rows="3" placeholder="ema(close, 9) - ema(close, 21)" required></textarea>
    </label>
    <div class="tv-ind-builder__help">
      Fields: <code>open</code>, <code>high</code>, <code>low</code>, <code>close</code>, <code>hl2</code>, <code>hlc3</code>.<br />
      Functions: <code>sma</code>, <code>ema</code>, <code>rsi</code>, <code>highest</code>, <code>lowest</code>, <code>change</code>, <code>abs</code>, <code>min</code>, <code>max</code>.
    </div>
    <div class="tv-ind-builder__row">
      <label class="tv-ind-builder__field">Show on
        <select name="placement"><option value="chart">Price chart</option><option value="pane">Separate pane</option></select>
      </label>
      <label class="tv-ind-builder__field tv-ind-builder__color">Line color
        <input name="color" type="color" value="#7c4dff" />
      </label>
    </div>
    <div class="tv-ind-builder__examples">
      <span>Try an example</span>
      <button type="button" data-example="sma(close, 20)">20 SMA</button>
      <button type="button" data-example="ema(close, 9) - ema(close, 21)">EMA spread</button>
      <button type="button" data-example="rsi(close, 14)">RSI</button>
    </div>
    <p class="tv-ind-builder__error" data-builder-error role="alert" hidden></p>
    <button type="submit" class="tv-ind-builder__submit">Create and add to chart</button>
  </form>
  <div class="tv-ind-lib__footer" data-library-footer>Select an indicator to add it to your chart</div>
</div>`;
  document.body.appendChild(root);

  const searchInput = root.querySelector("[data-search]");
  const listEl = root.querySelector("[data-list]");
  const clearBtn = root.querySelector("[data-clear]");
  const favFilterBtn = root.querySelector("[data-fav-filter]");
  const builder = root.querySelector("[data-builder]");
  const libraryView = root.querySelector("[data-library-view]");
  const searchWrap = root.querySelector(".tv-ind-lib__search-wrap");
  const createRow = root.querySelector("[data-library-create-row]");
  const footer = root.querySelector("[data-library-footer]");
  const titleEl = root.querySelector("#tv-ind-lib-title");

  if (!(searchInput instanceof HTMLInputElement) || !(listEl instanceof HTMLElement)) {
    throw new Error("Indicators library dialog mount failed");
  }

  let favorites = loadIndicatorFavorites();
  let query = "";
  let favoritesOnly = false;
  /** @type {HTMLElement | null} */
  let openAnchor = null;
  /** @type {((ev: Event) => void) | null} */
  let docClickHandler = null;

  function setBuilderOpen(open) {
    if (!(builder instanceof HTMLFormElement)) return;
    builder.hidden = !open;
    if (libraryView instanceof HTMLElement) libraryView.hidden = open;
    if (searchWrap instanceof HTMLElement) searchWrap.hidden = open;
    if (createRow instanceof HTMLElement) createRow.hidden = open;
    if (footer instanceof HTMLElement) footer.hidden = open;
    if (titleEl instanceof HTMLElement) titleEl.textContent = open ? "Custom indicator" : "Indicators";
    if (open) {
      const errorEl = builder.querySelector("[data-builder-error]");
      if (errorEl instanceof HTMLElement) errorEl.hidden = true;
      builder.querySelector("input[name=title]")?.focus();
    }
  }

  function removeDocListener() {
    if (docClickHandler) {
      document.removeEventListener("click", docClickHandler, true);
      docClickHandler = null;
    }
  }

  function syncClearButton() {
    if (!(clearBtn instanceof HTMLButtonElement)) return;
    clearBtn.hidden = !searchInput.value.trim();
  }

  function syncFavFilterButton() {
    if (!(favFilterBtn instanceof HTMLButtonElement)) return;
    favFilterBtn.setAttribute("aria-pressed", favoritesOnly ? "true" : "false");
    favFilterBtn.classList.toggle("is-active", favoritesOnly);
    favFilterBtn.innerHTML = favoritesOnly ? STAR_FILLED : STAR_OUTLINE;
    favFilterBtn.title = favoritesOnly ? "Show all indicators" : "Show favorites only";
    favFilterBtn.setAttribute(
      "aria-label",
      favoritesOnly ? "Show all indicators" : "Show favorites only",
    );
  }

  /** @param {HTMLElement} favBtn */
  function toggleFavoriteFromButton(favBtn) {
    const id = favBtn.dataset.id;
    if (!id) return;
    favorites = toggleIndicatorFavorite(favorites, id);
    renderList();
    onFavoritesChange?.();
  }

  function renderList() {
    const q = query.trim().toLowerCase();
    const items = listIndicators().filter((d) => {
      if (favoritesOnly && !isIndicatorFavorite(favorites, d.id)) return false;
      if (!q) return true;
      const title = d.title.toLowerCase();
      const shortTitle = (d.shortTitle || "").toLowerCase();
      return title.includes(q) || shortTitle.includes(q);
    });
    if (!items.length) {
      const message = favoritesOnly
        ? q
          ? "No favorite indicators matched your criteria"
          : "No favorite indicators yet"
        : q
          ? "No indicators matched your criteria"
          : "No indicators available";
      const hint = favoritesOnly
        ? q
          ? "Try a different search term"
          : "Star indicators to add them here"
        : q
          ? "Try a different search term"
          : "Check back later for new scripts";
      listEl.innerHTML = `<div class="tv-ind-lib__empty" role="status">
        <div class="tv-ind-lib__empty-icon" aria-hidden="true">${ICON_SEARCH}</div>
        <p class="tv-ind-lib__empty-text">${message}</p>
        <p class="tv-ind-lib__empty-hint">${hint}</p>
      </div>`;
      return;
    }
    listEl.innerHTML = `<div class="tv-ind-lib__section-title">${favoritesOnly ? "Favorites" : "Script name"}</div>${items
      .map((d) => {
        const fav = isIndicatorFavorite(favorites, d.id);
        const safeId = escapeHtml(d.id);
        const safeTitle = escapeHtml(d.title);
        return `<div class="tv-ind-lib__item" role="option" data-id="${safeId}" tabindex="0">
          <span class="tv-ind-lib__item-title">${safeTitle}</span>
          <div class="tv-ind-lib__item-actions">
            <button type="button" class="tv-ind-lib__fav-btn${fav ? " is-fav" : ""}" data-fav-toggle data-id="${safeId}" aria-label="${fav ? "Remove from favorites" : "Add to favorites"}" title="${fav ? "Remove from favorites" : "Add to favorites"}">${fav ? STAR_FILLED : STAR_OUTLINE}</button>
          </div>
        </div>`;
      })
      .join("")}`;
  }

  function close() {
    removeDocListener();
    openAnchor = null;
    root.hidden = true;
    document.body.classList.remove("tv-ind-lib-open");
    searchInput.value = "";
    query = "";
    favoritesOnly = false;
    syncClearButton();
    syncFavFilterButton();
    setBuilderOpen(false);
  }

  /** @param {HTMLElement} [anchor] */
  function open(anchor) {
    favorites = loadIndicatorFavorites();
    syncFavFilterButton();
    renderList();
    openAnchor = anchor ?? null;
    root.hidden = false;
    document.body.classList.add("tv-ind-lib-open");
    searchInput.value = "";
    query = "";
    syncClearButton();
    requestAnimationFrame(() => searchInput.focus());
    removeDocListener();
    docClickHandler = (ev) => {
      if (root.hidden) return;
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (root.contains(t)) return;
      if (openAnchor?.contains(t)) return;
      close();
    };
    setTimeout(() => {
      if (docClickHandler) document.addEventListener("click", docClickHandler, true);
    }, 0);
  }

  root.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    if (target.closest("[data-close], [data-backdrop]")) {
      close();
      return;
    }

    if (target.closest("[data-open-builder]")) {
      setBuilderOpen(true);
      return;
    }

    if (target.closest("[data-builder-back]")) {
      setBuilderOpen(false);
      searchInput.focus();
      return;
    }

    const example = target.closest("[data-example]");
    if (example instanceof HTMLElement && builder instanceof HTMLFormElement) {
      const formula = builder.elements.namedItem("formula");
      if (formula instanceof HTMLTextAreaElement) formula.value = example.dataset.example ?? "";
      return;
    }

    if (target.closest("[data-fav-filter]")) {
      favoritesOnly = !favoritesOnly;
      syncFavFilterButton();
      renderList();
      return;
    }

    const favBtn = target.closest("[data-fav-toggle]");
    if (favBtn instanceof HTMLElement) {
      ev.stopPropagation();
      toggleFavoriteFromButton(favBtn);
      return;
    }

    const item = target.closest(".tv-ind-lib__item");
    if (item instanceof HTMLElement && item.dataset.id) {
      onSelect(item.dataset.id);
      close();
    }
  });

  if (builder instanceof HTMLFormElement) {
    builder.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const data = new FormData(builder);
      const errorEl = builder.querySelector("[data-builder-error]");
      try {
        if (!onCreate) throw new Error("Custom indicators are not enabled");
        const defId = onCreate({
          title: String(data.get("title") ?? ""),
          formula: String(data.get("formula") ?? ""),
          color: String(data.get("color") ?? "#7c4dff"),
          placement: data.get("placement") === "pane" ? "pane" : "chart",
        });
        builder.reset();
        const color = builder.elements.namedItem("color");
        if (color instanceof HTMLInputElement) color.value = "#7c4dff";
        onSelect(defId);
        close();
      } catch (error) {
        if (errorEl instanceof HTMLElement) {
          errorEl.textContent = error instanceof Error ? error.message : "Could not create indicator";
          errorEl.hidden = false;
        }
      }
    });
  }

  listEl.addEventListener(
    "pointerup",
    (ev) => {
      const favBtn = ev.target instanceof Element ? ev.target.closest("[data-fav-toggle]") : null;
      if (!(favBtn instanceof HTMLElement)) return;
      if (ev.pointerType === "mouse") return;
      ev.preventDefault();
      ev.stopPropagation();
      toggleFavoriteFromButton(favBtn);
    },
    true,
  );

  listEl.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const item = ev.target instanceof Element ? ev.target.closest(".tv-ind-lib__item") : null;
    if (!(item instanceof HTMLElement) || !item.dataset.id) return;
    if (ev.target instanceof Element && ev.target.closest("[data-fav-toggle]")) return;
    ev.preventDefault();
    onSelect(item.dataset.id);
    close();
  });

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    syncClearButton();
    renderList();
  });

  searchInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
      openAnchor?.focus?.();
    }
  });

  if (clearBtn instanceof HTMLButtonElement) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      query = "";
      syncClearButton();
      searchInput.focus();
      renderList();
    });
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !root.hidden) {
      close();
      openAnchor?.focus?.();
    }
  });

  return { open, close };
}
