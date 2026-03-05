// --- DOM refs ---
const readyView = document.getElementById("ready-view");
const namesView = document.getElementById("names-view");
const instructionsView = document.getElementById("instructions-view");
const loadingView = document.getElementById("loading-view");
const extractBtn = document.getElementById("extract-btn");
const linkedinBtn = document.getElementById("linkedin-btn");
const namesOnlyBtn = document.getElementById("names-only-btn");
const status = document.getElementById("status");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const progressBarLi = document.getElementById("progress-bar-li");
const progressLabelLi = document.getElementById("progress-label-li");
const nameCountEl = document.getElementById("name-count");
const captchaNote = document.getElementById("captcha-note");
const statusLi = document.getElementById("status-li");

let extractedNames = [];
let partifulTabId = null;

// --- Helpers ---
function setStatus(el, msg, type = "") {
  el.textContent = msg;
  el.className = type ? `status ${type}` : "status";
}

function showProgress(bar, label, pct, text) {
  bar.parentElement.parentElement.style.display = "block";
  bar.style.width = pct + "%";
  label.textContent = text;
}

function showView(view) {
  [loadingView, instructionsView, readyView, namesView].forEach(
    (v) => (v.style.display = "none")
  );
  view.style.display = "block";
}

// --- Message listener for progress from injected scripts ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress") {
    showProgress(progressBar, progressLabel, msg.pct, msg.label);
  }
});

// --- On popup open: check if guest list is visible ---
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    partifulTabId = tab?.id;

    if (!tab?.url?.includes("partiful.com")) {
      showView(instructionsView);
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: checkGuestListVisible,
    });

    showView(results?.[0]?.result ? readyView : instructionsView);
  } catch {
    showView(instructionsView);
  }
})();

function checkGuestListVisible() {
  // Primary: Partiful uses id="guest-list-modal" with aria-modal="true"
  if (document.querySelector('#guest-list-modal, [aria-modal="true"]')) return true;
  // Fallback: tabs with data-tab-id (Going, Maybe, etc.)
  if (document.querySelectorAll('[role="tab"][data-tab-id]').length > 0) return true;
  return false;
}

// --- Step 1: Extract names ---
extractBtn.addEventListener("click", async () => {
  extractBtn.disabled = true;
  setStatus(status, "");
  showProgress(progressBar, progressLabel, 5, "Starting extraction...");

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: partifulTabId },
      func: extractNamesFromPage,
    });

    extractedNames = results?.[0]?.result || [];

    if (extractedNames.length === 0) {
      showProgress(progressBar, progressLabel, 0, "");
      setStatus(status, "No names found. Make sure the guest list is open.", "error");
      extractBtn.disabled = false;
      return;
    }

    nameCountEl.textContent = `Found ${extractedNames.length} names`;
    showView(namesView);
  } catch (err) {
    setStatus(status, `Error: ${err.message}`, "error");
    extractBtn.disabled = false;
  }
});

// --- Download names only ---
namesOnlyBtn.addEventListener("click", async () => {
  await chrome.scripting.executeScript({
    target: { tabId: partifulTabId },
    func: downloadNamesCSV,
    args: [extractedNames],
  });
  setStatus(statusLi, `Downloaded ${extractedNames.length} names`, "success");
});

// --- Step 2: LinkedIn search ---
linkedinBtn.addEventListener("click", async () => {
  linkedinBtn.disabled = true;
  namesOnlyBtn.disabled = true;
  setStatus(statusLi, "");
  captchaNote.style.display = "none";

  const LOCATION = "san francisco";
  const DELAY = 1500;
  const results = [];
  let searchTab = null;

  try {
    showProgress(progressBarLi, progressLabelLi, 2, "Opening search tab...");
    searchTab = await chrome.tabs.create({ url: "https://www.google.com", active: false });
    await sleep(1500);

    for (let i = 0; i < extractedNames.length; i++) {
      const name = extractedNames[i];
      const pct = Math.round(((i + 1) / extractedNames.length) * 95);
      showProgress(progressBarLi, progressLabelLi, pct,
        `[${i + 1}/${extractedNames.length}] ${name}`);

      const query = `linkedin ${name} ${LOCATION}`;
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

      await chrome.tabs.update(searchTab.id, { url: searchUrl });
      await waitForTabLoad(searchTab.id);
      await sleep(500);

      // Check for CAPTCHA
      let isCaptcha = await checkCaptchaOnTab(searchTab.id);
      if (isCaptcha) {
        captchaNote.style.display = "block";
        await chrome.tabs.update(searchTab.id, { active: true });
        showProgress(progressBarLi, progressLabelLi, pct,
          `CAPTCHA - solve it, then come back`);

        while (isCaptcha) {
          await sleep(3000);
          isCaptcha = await checkCaptchaOnTab(searchTab.id);
        }

        captchaNote.style.display = "none";
        // Retry the search
        await chrome.tabs.update(searchTab.id, { url: searchUrl, active: false });
        await waitForTabLoad(searchTab.id);
        await sleep(500);
      }

      // Extract LinkedIn URL
      const liResults = await chrome.scripting.executeScript({
        target: { tabId: searchTab.id },
        func: extractLinkedInUrl,
      });

      const linkedinUrl = liResults?.[0]?.result || "";
      results.push({ name, linkedin_url: linkedinUrl });

      if (i < extractedNames.length - 1) {
        await sleep(DELAY);
      }
    }

    // Close search tab
    try { await chrome.tabs.remove(searchTab.id); } catch {}

    showProgress(progressBarLi, progressLabelLi, 98, "Downloading CSV...");

    // Download full CSV via partiful tab
    await chrome.scripting.executeScript({
      target: { tabId: partifulTabId },
      func: downloadFullCSV,
      args: [results],
    });

    const found = results.filter((r) => r.linkedin_url).length;
    showProgress(progressBarLi, progressLabelLi, 100, "Done!");
    setStatus(statusLi,
      `Downloaded! ${found}/${results.length} LinkedIn profiles found.`, "success");
  } catch (err) {
    if (searchTab) {
      try { await chrome.tabs.remove(searchTab.id); } catch {}
    }
    setStatus(statusLi, `Error: ${err.message}`, "error");
  }

  linkedinBtn.disabled = false;
  namesOnlyBtn.disabled = false;
});

// --- Utility functions ---
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
    // Timeout safety
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

  // Dynamically find attendee cards instead of relying on a specific class name.
  // Strategy: find the modal container (has close button + h3 heading), then look
  // for repeated sibling elements that contain avatar-like elements or short text.
  function findCards() {
    // Find the modal first
    const modalRoot =
      document.querySelector('#guest-list-modal') ||
      document.querySelector('[aria-modal="true"]');

    // Try known card selector within the modal (or whole page as fallback)
    const scope = modalRoot || document;
    let cards = Array.from(scope.querySelectorAll('div[class*="ptf-GDaG7"]'));
    if (cards.length > 0) return cards;

    if (!modalRoot) return [];

    // Look for groups of sibling divs with ptf- classes that contain short text
    // (attendee cards). Find the largest such group.
    const allDivs = modalRoot.querySelectorAll('div[class*="ptf-"]');
    const classCounts = {};
    for (const div of allDivs) {
      const text = norm(div.innerText);
      // Cards have short text (name + maybe a subtitle), not huge blocks
      if (!text || text.length > 200 || text.length < 2) continue;
      // Group by the element's className
      const cls = div.className;
      if (!classCounts[cls]) classCounts[cls] = [];
      classCounts[cls].push(div);
    }

    // The attendee cards are the largest group of identically-classed divs (3+)
    let bestGroup = [];
    for (const group of Object.values(classCounts)) {
      if (group.length > bestGroup.length && group.length >= 3) {
        bestGroup = group;
      }
    }

    return bestGroup;
  }

  function getScrollTarget() {
    return (
      document.querySelector('[class*="ptf-"] [style*="overflow"]') ||
      document.scrollingElement
    );
  }

  async function scrollToLoadAll() {
    const scrollable = getScrollTarget();
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

  // Find guest list tabs -- may not exist on all event types
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
