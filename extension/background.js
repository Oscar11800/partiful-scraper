// --- State ---
let state = {
  phase: "idle", // idle | extracting | names-ready | linkedin | done | stopped | error
  names: [],
  results: [],
  progress: { pct: 0, label: "" },
  captcha: false,
  error: null,
  partifulTabId: null,
  searchTabId: null,
};

let stopRequested = false;

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function updateProgress(pct, label) {
  state.progress = { pct, label };
  broadcast({ type: "state-update", state });
}

function setState(changes) {
  Object.assign(state, changes);
  broadcast({ type: "state-update", state });
}

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-state") {
    sendResponse(state);
    return;
  }

  if (msg.type === "start-extract") {
    state.partifulTabId = msg.tabId;
    runExtraction(msg.tabId);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "start-linkedin") {
    runLinkedInSearch();
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "download-names") {
    downloadViaTab(state.partifulTabId, state.names, "names");
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "stop") {
    stopRequested = true;
    setState({ phase: "stopped" });
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "reset") {
    stopRequested = false;
    state = {
      phase: "idle",
      names: [],
      results: [],
      progress: { pct: 0, label: "" },
      captcha: false,
      error: null,
      partifulTabId: state.partifulTabId,
      searchTabId: null,
    };
    broadcast({ type: "state-update", state });
    sendResponse({ ok: true });
    return;
  }
});

// --- Name extraction ---
async function runExtraction(tabId) {
  stopRequested = false;
  setState({ phase: "extracting", names: [], results: [], error: null, captcha: false });
  updateProgress(5, "Starting extraction...");

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractNamesFromPage,
    });

    if (stopRequested) return;

    const names = results?.[0]?.result || [];
    if (names.length === 0) {
      setState({ phase: "error", error: "No names found. Make sure the guest list is open." });
      return;
    }

    setState({ phase: "names-ready", names });
    updateProgress(100, `Found ${names.length} names`);
  } catch (err) {
    setState({ phase: "error", error: err.message });
  }
}

// --- LinkedIn search ---
async function runLinkedInSearch() {
  stopRequested = false;
  const LOCATION = "san francisco";
  const DELAY = 1500;

  setState({ phase: "linkedin", results: [], captcha: false, error: null });
  updateProgress(2, "Opening search tab...");

  let searchTab = null;

  try {
    searchTab = await chrome.tabs.create({ url: "https://www.google.com", active: false });
    state.searchTabId = searchTab.id;
    await sleep(1500);

    for (let i = 0; i < state.names.length; i++) {
      if (stopRequested) {
        try { await chrome.tabs.remove(searchTab.id); } catch {}
        if (state.results.length > 0) {
          await downloadViaTab(state.partifulTabId, state.results, "full");
        }
        return;
      }

      const name = state.names[i];
      const pct = Math.round(((i + 1) / state.names.length) * 95);
      updateProgress(pct, `[${i + 1}/${state.names.length}] ${name}`);

      const query = `linkedin ${name} ${LOCATION}`;
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

      await chrome.tabs.update(searchTab.id, { url: searchUrl });
      await waitForTabLoad(searchTab.id);
      await sleep(500);

      let isCaptcha = await checkCaptchaOnTab(searchTab.id);
      if (isCaptcha) {
        setState({ captcha: true });
        updateProgress(pct, "CAPTCHA - solve it in the Google tab");
        await chrome.tabs.update(searchTab.id, { active: true });

        while (isCaptcha && !stopRequested) {
          await sleep(3000);
          isCaptcha = await checkCaptchaOnTab(searchTab.id);
        }

        if (stopRequested) {
          try { await chrome.tabs.remove(searchTab.id); } catch {}
          if (state.results.length > 0) {
            await downloadViaTab(state.partifulTabId, state.results, "full");
          }
          return;
        }

        setState({ captcha: false });
        await chrome.tabs.update(searchTab.id, { url: searchUrl, active: false });
        await waitForTabLoad(searchTab.id);
        await sleep(500);
      }

      const liResults = await chrome.scripting.executeScript({
        target: { tabId: searchTab.id },
        func: extractLinkedInUrl,
      });

      const linkedinUrl = liResults?.[0]?.result || "";
      state.results.push({ name, linkedin_url: linkedinUrl });

      if (i < state.names.length - 1) {
        await sleep(DELAY);
      }
    }

    try { await chrome.tabs.remove(searchTab.id); } catch {}

    updateProgress(98, "Downloading CSV...");
    await downloadViaTab(state.partifulTabId, state.results, "full");

    const found = state.results.filter((r) => r.linkedin_url).length;
    updateProgress(100, "Done!");
    setState({ phase: "done", error: null });
    broadcast({
      type: "state-update",
      state,
      statusMsg: `Downloaded! ${found}/${state.results.length} LinkedIn profiles found.`,
    });
  } catch (err) {
    if (searchTab) {
      try { await chrome.tabs.remove(searchTab.id); } catch {}
    }
    setState({ phase: "error", error: err.message });
  }
}

// --- Download helpers ---
async function downloadViaTab(tabId, data, mode) {
  if (mode === "names") {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: downloadNamesCSV,
      args: [data],
    });
  } else {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: downloadFullCSV,
      args: [data],
    });
  }
}

// --- Utility ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });
}

async function checkCaptchaOnTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const url = window.location.href.toLowerCase();
        if (url.includes("sorry") || url.includes("captcha")) return true;
        const text = document.body?.innerText?.toLowerCase() || "";
        return (
          text.includes("unusual traffic") ||
          text.includes("not a robot") ||
          text.includes("recaptcha") ||
          text.includes("automated queries")
        );
      },
    });
    return results?.[0]?.result || false;
  } catch {
    return false;
  }
}

// --- Functions injected into pages ---

function extractNamesFromPage() {
  const norm = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();
  const isStatus = (s) => /^and\s+\d+\s+more$/i.test(s);
  const hasAtHandle = (s) => /(^|\s)@[\w.-]+/i.test(s);
  const looksLikeURL = (s) => /\bhttps?:\/\/|www\.|\.[a-z]{2,}\b/i.test(s);

  function isPlausibleName(s) {
    const t = norm(s);
    if (!t) return false;
    if (isStatus(t)) return false;
    if (hasAtHandle(t)) return false;
    if (looksLikeURL(t)) return false;
    if (!/\p{L}/u.test(t)) return false;
    const letters = (t.match(/\p{L}/gu) || []).length;
    const total = t.replace(/\s/g, "").length || 1;
    if (letters / total < 0.6) return false;
    return true;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function progress(pct, label) {
    try { chrome.runtime.sendMessage({ type: "progress", pct, label }); } catch {}
  }

  function findCards() {
    const modalRoot =
      document.querySelector('#guest-list-modal') ||
      document.querySelector('[aria-modal="true"]');
    const scope = modalRoot || document;
    let cards = Array.from(scope.querySelectorAll('div[class*="ptf-GDaG7"]'));
    if (cards.length > 0) return cards;
    if (!modalRoot) return [];

    const allDivs = modalRoot.querySelectorAll('div[class*="ptf-"]');
    const classCounts = {};
    for (const div of allDivs) {
      const text = norm(div.innerText);
      if (!text || text.length > 200 || text.length < 2) continue;
      const cls = div.className;
      if (!classCounts[cls]) classCounts[cls] = [];
      classCounts[cls].push(div);
    }
    let bestGroup = [];
    for (const group of Object.values(classCounts)) {
      if (group.length > bestGroup.length && group.length >= 3) bestGroup = group;
    }
    return bestGroup;
  }

  async function scrollToLoadAll() {
    const scrollable =
      document.querySelector('[class*="ptf-"] [style*="overflow"]') ||
      document.scrollingElement;
    if (!scrollable) return;
    let prev = -1;
    let curr = findCards().length;
    for (let i = 0; i < 50 && curr !== prev; i++) {
      prev = curr;
      scrollable.scrollTop = scrollable.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(400);
      curr = findCards().length;
    }
    window.scrollTo(0, 0);
  }

  function getNamesFromView() {
    return findCards()
      .map((card) => {
        const lines = (card.innerText || "").split("\n").map(norm).filter(Boolean);
        return lines[0] || "";
      })
      .filter(Boolean)
      .filter(isPlausibleName);
  }

  function findGuestListTabs() {
    return Array.from(document.querySelectorAll('[role="tab"][data-tab-id]'));
  }

  return (async () => {
    const allNames = [];
    const seen = new Set();
    function add(names) {
      for (const n of names) {
        const k = n.toLowerCase();
        if (!seen.has(k)) { seen.add(k); allNames.push(n); }
      }
    }

    progress(10, "Looking for guest list tabs...");
    const tabs = findGuestListTabs();

    if (tabs.length <= 1) {
      progress(20, "Scrolling to load all names...");
      await scrollToLoadAll();
      progress(70, "Extracting names...");
      add(getNamesFromView());
    } else {
      for (let i = 0; i < tabs.length; i++) {
        const tabName = tabs[i].dataset.tabId || norm(tabs[i].innerText);
        const basePct = 10 + ((i / tabs.length) * 75);
        progress(Math.round(basePct), `Tab ${i + 1}/${tabs.length}: ${tabName}`);
        tabs[i].click();
        await sleep(800);
        progress(Math.round(basePct + 15), `Scrolling: ${tabName}...`);
        await scrollToLoadAll();
        progress(Math.round(basePct + 30), `Extracting: ${tabName}...`);
        add(getNamesFromView());
      }
    }

    progress(90, `Found ${allNames.length} names total`);
    return allNames;
  })();
}

function extractLinkedInUrl() {
  const links = document.querySelectorAll('#search a[href*="linkedin.com/in/"]');
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    if (href.includes("/url?q=")) {
      const match = href.match(/linkedin\.com\/in\/[^&?]+/);
      if (match) return "https://www." + match[0];
    } else {
      const match = href.match(/https?:\/\/[^/]*linkedin\.com\/in\/[^?&\s]+/);
      if (match) return match[0];
    }
  }
  return "";
}

function downloadNamesCSV(names) {
  const date = new Date().toISOString().slice(0, 10);
  const csv = "name\n" + names.join("\n") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `partiful_names_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadFullCSV(results) {
  const date = new Date().toISOString().slice(0, 10);
  const header = "name,linkedin_url";
  const rows = results.map((r) => {
    const name = r.name.includes(",") ? `"${r.name}"` : r.name;
    return `${name},${r.linkedin_url}`;
  });
  const csv = [header, ...rows].join("\n") + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `partiful_linkedin_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
