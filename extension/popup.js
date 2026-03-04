const readyView = document.getElementById("ready-view");
const instructionsView = document.getElementById("instructions-view");
const loadingView = document.getElementById("loading-view");
const btn = document.getElementById("extract-btn");
const status = document.getElementById("status");
const progressContainer = document.getElementById("progress-container");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");

function setStatus(msg, type = "") {
  status.textContent = msg;
  status.className = type;
}

function showProgress(pct, label) {
  progressContainer.style.display = "block";
  progressBar.style.width = pct + "%";
  progressLabel.textContent = label;
}

function hideProgress() {
  progressContainer.style.display = "none";
  progressBar.style.width = "0%";
  progressLabel.textContent = "";
}

function showReady() {
  loadingView.style.display = "none";
  instructionsView.style.display = "none";
  readyView.style.display = "block";
}

function showInstructions() {
  loadingView.style.display = "none";
  readyView.style.display = "none";
  instructionsView.style.display = "block";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress") {
    showProgress(msg.pct, msg.label);
  }
});

// On popup open: check if the guest list is visible
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.url?.includes("partiful.com")) {
      showInstructions();
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: checkGuestListVisible,
    });

    if (results?.[0]?.result) {
      showReady();
    } else {
      showInstructions();
    }
  } catch {
    showInstructions();
  }
})();

function checkGuestListVisible() {
  // The guest list MODAL (not the preview on the main page) has:
  // 1. A close button with an icon-cross SVG, AND
  // 2. An h3 "Guest List" heading in the same parent container
  // Check for the close button + heading combo that only exists in the modal.
  const crossBtn = document.querySelector('use[href*="icon-cross"]');
  if (crossBtn) {
    const container = crossBtn.closest('div[class*="ptf-"]')?.parentElement?.parentElement;
    if (container) {
      const h3 = container.querySelector('h3');
      if (h3 && h3.textContent.trim() === 'Guest List') return true;
    }
  }
  // Fallback: tabs with data-tab-id only exist in the modal
  return document.querySelectorAll('[role="tab"][data-tab-id]').length > 0;
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  hideProgress();
  setStatus("");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    showProgress(5, "Starting extraction...");

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractNamesFromPage,
    });

    const names = results?.[0]?.result;

    if (!names || names.length === 0) {
      hideProgress();
      setStatus("No names found. Make sure the guest list is open and visible.", "error");
      btn.disabled = false;
      return;
    }

    showProgress(95, "Downloading CSV...");

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: downloadCSV,
      args: [names],
    });

    showProgress(100, "Done!");
    setStatus(`Downloaded ${names.length} names!`, "success");
  } catch (err) {
    hideProgress();
    setStatus(`Error: ${err.message}`, "error");
  }

  btn.disabled = false;
});

function extractNamesFromPage() {
  const CARD_SELECTOR = 'div[class*="ptf-GDaG7"]';

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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function progress(pct, label) {
    try {
      chrome.runtime.sendMessage({ type: "progress", pct, label });
    } catch {}
  }

  async function scrollToLoadAll() {
    const scrollable =
      document.querySelector('[class*="ptf-"] [style*="overflow"]') ||
      document.scrollingElement;
    if (!scrollable) return;

    let prev = -1;
    let curr = document.querySelectorAll(CARD_SELECTOR).length;
    for (let i = 0; i < 50 && curr !== prev; i++) {
      prev = curr;
      scrollable.scrollTop = scrollable.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(400);
      curr = document.querySelectorAll(CARD_SELECTOR).length;
    }
    window.scrollTo(0, 0);
  }

  function getNamesFromView() {
    return Array.from(document.querySelectorAll(CARD_SELECTOR))
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
        if (!seen.has(k)) {
          seen.add(k);
          allNames.push(n);
        }
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

function downloadCSV(names) {
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
