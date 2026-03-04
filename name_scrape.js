// DevTools Console script (reusable)
// Extracts a vertical list of "full names" from Partiful-like attendee cards,
// filters out non-name lines (taglines, handles, URLs, "and 1 more"),
// prints + copies to clipboard.

(() => {
    const norm = (s) => (s ?? "").toString().replace(/\s+/g, " ").trim();
  
    const isStatus = (s) => /^and\s+\d+\s+more$/i.test(s);
    const hasAtHandle = (s) => /(^|\s)@[\w.-]+/i.test(s);
    const looksLikeURL = (s) => /\bhttps?:\/\/|www\.|\.[a-z]{2,}\b/i.test(s);
  
    // "Full name" heuristic:
    // - >= 2 tokens (filters out single-word first names like "Alicia")
    // - no @handles, no URLs, not "and 1 more"
    // - mostly letters (works with accents/apostrophes)
    const isFullName = (s) => {
      const t = norm(s);
      if (!t) return false;
      if (isStatus(t)) return false;
      if (hasAtHandle(t)) return false;
      if (looksLikeURL(t)) return false;
  
      const parts = t.split(" ").filter(Boolean);
      if (parts.length < 2) return false;
  
      // must contain letters
      if (!/\p{L}/u.test(t)) return false;
  
      // reject strings with too little letter content (helps avoid weird tokens)
      const letters = (t.match(/\p{L}/gu) || []).length;
      const total = t.replace(/\s/g, "").length || 1;
      if (letters / total < 0.6) return false;
  
      return true;
    };
  
    // Update this selector if Partiful changes; your earlier DOM matched ptf-GDaG7 cards.
    const CARD_SELECTOR = 'div[class*="ptf-GDaG7"]';
    const cards = Array.from(document.querySelectorAll(CARD_SELECTOR));
  
    // Only take the first line of each card -- that's always the display name.
    // Lines 2+ are descriptions/taglines and pollute results.
    const candidates = cards.map((card) => {
      const lines = (card.innerText || "")
        .split("\n")
        .map(norm)
        .filter(Boolean);
      return lines[0] || "";
    }).filter(Boolean);
  
    const filtered = candidates.filter(isFullName);
  
    // De-dupe while preserving order
    const seen = new Set();
    const names = filtered.filter((n) => {
      const k = n.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  
    const out = names.join("\n");
  
    // Print + copy
    console.log(out);
    try {
      copy(out);
      console.log(`Copied ${names.length} full name(s) to clipboard.`);
    } catch {
      console.log(`Found ${names.length} full name(s). (Clipboard copy unavailable here.)`);
    }
  
    return names;
  })();