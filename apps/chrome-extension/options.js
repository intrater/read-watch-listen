// Persists the capture endpoint + token to chrome.storage.local. Keeping the
// token here (not in the committed source) means the repo never holds a secret.

const DEFAULT_ENDPOINT = "https://rwl-api.vercel.app/api/capture";
const $ = (id) => document.getElementById(id);

async function load() {
  const { endpoint, token } = await chrome.storage.local.get(["endpoint", "token"]);
  $("endpoint").value = endpoint || DEFAULT_ENDPOINT;
  $("token").value = token || "";
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    endpoint: $("endpoint").value.trim() || DEFAULT_ENDPOINT,
    token: $("token").value.trim(),
  });
  const saved = $("saved");
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1500);
});

load();
