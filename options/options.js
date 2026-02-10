(function () {
  const STORAGE_KEYS = {
    supabaseUrl: "ff_supabase_url",
    supabaseAnonKey: "ff_supabase_anon_key"
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    const el = $("status");
    if (!el) return;
    el.textContent = String(text || "");
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (items) => resolve(items || {}));
      } catch {
        resolve({});
      }
    });
  }

  function storageSet(items) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(items, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys, () => resolve());
      } catch {
        resolve();
      }
    });
  }

  function normalizeUrl(url) {
    return String(url || "")
      .trim()
      .replace(/\/+$/, "");
  }

  async function loadInitialValues() {
    const items = await storageGet([STORAGE_KEYS.supabaseUrl, STORAGE_KEYS.supabaseAnonKey]);
    $("supabaseUrl").value = String(items[STORAGE_KEYS.supabaseUrl] || "");
    $("supabaseAnonKey").value = String(items[STORAGE_KEYS.supabaseAnonKey] || "");
  }

  async function saveValues() {
    const url = normalizeUrl($("supabaseUrl").value);
    const anonKey = String($("supabaseAnonKey").value || "").trim();

    if (!url || !anonKey) {
      setStatus("Please provide both a Supabase URL and anon key.");
      return;
    }

    await storageSet({
      [STORAGE_KEYS.supabaseUrl]: url,
      [STORAGE_KEYS.supabaseAnonKey]: anonKey
    });

    setStatus("Saved.");
  }

  async function clearValues() {
    await storageRemove([STORAGE_KEYS.supabaseUrl, STORAGE_KEYS.supabaseAnonKey]);
    $("supabaseUrl").value = "";
    $("supabaseAnonKey").value = "";
    setStatus("Cleared.");
  }

  async function testConnection() {
    setStatus("Testing connection...");

    const url = normalizeUrl($("supabaseUrl").value);
    const anonKey = String($("supabaseAnonKey").value || "").trim();

    if (!url || !anonKey) {
      setStatus("Please provide both a Supabase URL and anon key.");
      return;
    }

    try {
      const endpoint = `${url}/rest/v1/products2`;
      const qs = new URLSearchParams({ select: "id", is_active: "eq.true", limit: "1" });

      const res = await fetch(`${endpoint}?${qs.toString()}`, {
        method: "GET",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: "application/json"
        }
      });

      const text = await res.text();
      if (!res.ok) {
        setStatus(`Test failed: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
        return;
      }

      setStatus("Test OK. Supabase is reachable.");
    } catch (err) {
      setStatus(`Test error: ${err?.message || String(err)}`);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await loadInitialValues();

    $("save").addEventListener("click", saveValues);
    $("clear").addEventListener("click", clearValues);
    $("test").addEventListener("click", testConnection);
  });
})();
