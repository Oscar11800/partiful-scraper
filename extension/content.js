(() => {
  if (document.getElementById("ptf-extract-btn")) return;

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

  async function scrollToLoadAll() {
    const scrollable =
      document.querySelector('[class*="ptf-"] [style*="overflow"]') ||
      document.scrollingElement;
    if (!scrollable) return;

    let prev = -1;
    let curr = document.querySelectorAll(CARD_SELECTOR).length;
    const MAX_ROUNDS = 50;

    for (let i = 0; i < MAX_ROUNDS && curr !== prev; i++) {
      prev = curr;
      scrollable.scrollTop = scrollable.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 400));
      curr = document.querySelectorAll(CARD_SELECTOR).length;
    }
    window.scrollTo(0, 0);
  }

  function extractNames() {
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));

    const candidates = cards
      .map((card) => {
        const lines = (card.innerText || "")
          .split("\n")
          .map(norm)
          .filter(Boolean);
        return lines[0] || "";
      })
      .filter(Boolean);

    const filtered = candidates.filter(isPlausibleName);

    const seen = new Set();
    return filtered.filter((n) => {
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function downloadCSV(names) {
    const date = new Date().toISOString().slice(0, 10);
    const csvContent = "name\n" + names.join("\n") + "\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `partiful_names_${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const btn = document.createElement("button");
  btn.id = "ptf-extract-btn";
  btn.textContent = "Extract Names";

  btn.addEventListener("click", async () => {
    btn.textContent = "Scrolling...";
    btn.disabled = true;
    await scrollToLoadAll();

    btn.textContent = "Extracting...";
    const names = extractNames();

    if (names.length === 0) {
      btn.textContent = "No names found";
      setTimeout(() => {
        btn.textContent = "Extract Names";
        btn.disabled = false;
      }, 2000);
      return;
    }

    downloadCSV(names);
    btn.textContent = `Downloaded ${names.length} names`;
    setTimeout(() => {
      btn.textContent = "Extract Names";
      btn.disabled = false;
    }, 3000);
  });

  document.body.appendChild(btn);
})();
