// RWL Capture popup. Reads the endpoint + token from chrome.storage.local
// (set on the options page, so the secret never lives in the committed code),
// prefills the active tab, and POSTs to /api/capture as source 'chrome-ext'.

const $ = (id) => document.getElementById(id);
let tab;
let cfg = {};

function setStatus(msg, kind) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (kind ? " " + kind : "");
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("title").textContent = tab?.title || "(untitled)";
  $("url").textContent = tab?.url || "";
  cfg = await chrome.storage.local.get(["endpoint", "token"]);
  if (!cfg.endpoint || !cfg.token) {
    $("config").hidden = false;
    $("save").disabled = true;
  }
}

$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

$("save").addEventListener("click", async () => {
  if (!tab?.url) return;
  $("save").disabled = true;
  setStatus("Saving…");
  const note = $("note").value.trim();
  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify({ url: tab.url, note: note || undefined, source: "chrome-ext" }),
    });

    if (res.status === 401) {
      setStatus("Auth error — check extension settings", "err");
      $("save").disabled = false;
      return;
    }
    if (!res.ok) {
      setStatus("Save failed — try again", "err");
      $("save").disabled = false;
      return;
    }

    const data = await res.json().catch(() => ({}));
    setStatus(data.status === "updated" ? "Note updated in RWL ✓" : "Saved to RWL ✓", "ok");
    $("note").value = ""; // clears on success, retained on error
    setTimeout(() => window.close(), 1500);
  } catch {
    setStatus("Save failed — try again", "err");
    $("save").disabled = false;
  }
});

init();
