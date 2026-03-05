// --- DOM refs ---
const views = {
  loading: document.getElementById("loading-view"),
  instructions: document.getElementById("instructions-view"),
  ready: document.getElementById("ready-view"),
  extracting: document.getElementById("extracting-view"),
  names: document.getElementById("names-view"),
  linkedin: document.getElementById("linkedin-view"),
  done: document.getElementById("done-view"),
  error: document.getElementById("error-view"),
};

const extractBtn = document.getElementById("extract-btn");
const linkedinBtn = document.getElementById("linkedin-btn");
const namesOnlyBtn = document.getElementById("names-only-btn");
const stopExtractBtn = document.getElementById("stop-extract-btn");
const stopLiBtn = document.getElementById("stop-li-btn");
const resetBtn = document.getElementById("reset-btn");
const retryBtn = document.getElementById("retry-btn");
const nameCountEl = document.getElementById("name-count");
const extractProgress = document.getElementById("extract-progress");
const extractLabel = document.getElementById("extract-label");
const liProgress = document.getElementById("li-progress");
const liLabel = document.getElementById("li-label");
const captchaNote = document.getElementById("captcha-note");
const doneStatus = document.getElementById("done-status");
const errorStatus = document.getElementById("error-status");

// --- View management ---
function showView(name) {
  Object.values(views).forEach((v) => (v.style.display = "none"));
  if (views[name]) views[name].style.display = "block";
}

// --- Render state from background ---
function renderState(st, statusMsg) {
  switch (st.phase) {
    case "idle":
      checkPageAndShow();
      break;
    case "extracting":
      showView("extracting");
      extractProgress.style.width = st.progress.pct + "%";
      extractLabel.textContent = st.progress.label;
      break;
    case "names-ready":
      showView("names");
      nameCountEl.textContent = `Found ${st.names.length} names`;
      break;
    case "linkedin":
      showView("linkedin");
      liProgress.style.width = st.progress.pct + "%";
      liLabel.textContent = st.progress.label;
      captchaNote.style.display = st.captcha ? "block" : "none";
      break;
    case "done":
      showView("done");
      doneStatus.textContent = statusMsg || `Done! ${st.results.filter((r) => r.linkedin_url).length}/${st.results.length} LinkedIn profiles found.`;
      break;
    case "stopped":
      showView("done");
      doneStatus.textContent = "Stopped. Partial results downloaded if available.";
      break;
    case "error":
      showView("error");
      errorStatus.textContent = st.error || "An error occurred.";
      break;
  }
}

async function checkPageAndShow() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes("partiful.com")) {
      showView("instructions");
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: checkGuestListVisible,
    });
    showView(results?.[0]?.result ? "ready" : "instructions");
  } catch {
    showView("instructions");
  }
}

function checkGuestListVisible() {
  if (document.querySelector('#guest-list-modal, [aria-modal="true"]')) return true;
  if (document.querySelectorAll('[role="tab"][data-tab-id]').length > 0) return true;
  return false;
}

// --- On popup open: get state from background ---
(async () => {
  try {
    const st = await chrome.runtime.sendMessage({ type: "get-state" });
    if (st && st.phase !== "idle") {
      renderState(st);
    } else {
      checkPageAndShow();
    }
  } catch {
    checkPageAndShow();
  }
})();

// --- Listen for state updates from background ---
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state-update") {
    renderState(msg.state, msg.statusMsg);
  }
});

// --- Button handlers ---
extractBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ type: "start-extract", tabId: tab.id });
  showView("extracting");
});

linkedinBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "start-linkedin" });
  showView("linkedin");
});

namesOnlyBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "download-names" });
  showView("done");
  doneStatus.textContent = "Names CSV downloaded!";
});

stopExtractBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop" });
});

stopLiBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "stop" });
});

resetBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reset" });
  checkPageAndShow();
});

retryBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reset" });
  checkPageAndShow();
});
