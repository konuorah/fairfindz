(function () {
  const STORAGE_KEYS = {
    supabaseUrl: "ff_supabase_url",
    supabaseAnonKey: "ff_supabase_anon_key",
    session: "ff_supabase_session",
    guest: "ff_guest_mode",
    authPromptSeen: "ff_auth_prompt_seen"
  };

  const DEFAULTS = {
    supabaseUrl: "",
    supabaseAnonKey: ""
  };

  function isValidEmail(email) {
    const s = String(email || "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function normalizeErrorMessage(message) {
    const msg = String(message || "").trim();
    const lowered = msg.toLowerCase();

    if (!msg) return "Something went wrong. Please try again.";
    if (lowered.includes("already registered") || lowered.includes("already exists") || lowered.includes("user already")) {
      return "This email is already registered";
    }
    if (lowered.includes("invalid") && lowered.includes("email")) {
      return "Please enter a valid email address";
    }
    if (lowered.includes("password") && (lowered.includes("least") || lowered.includes("short"))) {
      return "Password must be at least 8 characters";
    }

    return msg;
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

  async function getSupabaseConfig() {
    const items = await storageGet([STORAGE_KEYS.supabaseUrl, STORAGE_KEYS.supabaseAnonKey]);
    return {
      url: String(items[STORAGE_KEYS.supabaseUrl] || DEFAULTS.supabaseUrl || "").trim(),
      anonKey: String(items[STORAGE_KEYS.supabaseAnonKey] || DEFAULTS.supabaseAnonKey || "").trim()
    };
  }

  async function getAuthState() {
    const items = await storageGet([STORAGE_KEYS.session, STORAGE_KEYS.guest]);
    const session = items[STORAGE_KEYS.session] || null;
    const guest = Boolean(items[STORAGE_KEYS.guest]);

    const accessToken = session && typeof session === "object" ? session.access_token : null;
    return { session, guest, isAuthenticated: Boolean(accessToken) };
  }

  async function markAuthPromptSeen() {
    await storageSet({ [STORAGE_KEYS.authPromptSeen]: true });
  }

  async function wasAuthPromptSeen() {
    const items = await storageGet([STORAGE_KEYS.authPromptSeen]);
    return Boolean(items[STORAGE_KEYS.authPromptSeen]);
  }

  async function saveSession(session) {
    await storageSet({
      [STORAGE_KEYS.session]: session,
      [STORAGE_KEYS.guest]: false
    });
  }

  async function setGuestMode() {
    await storageSet({
      [STORAGE_KEYS.guest]: true
    });
  }

  function setLoading(buttonEl, isLoading) {
    if (!buttonEl) return;
    buttonEl.disabled = Boolean(isLoading);
    buttonEl.classList.toggle("ff-auth-loading", Boolean(isLoading));

    const textEl = buttonEl.querySelector(".ff-auth-button-text");
    if (textEl) textEl.textContent = isLoading ? "Signing up..." : "Sign Up";
  }

  function focusFirstFocusable(container) {
    const el = container.querySelector(
      'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (el && typeof el.focus === "function") el.focus();
  }

  async function supabaseSignUp({ email, password }) {
    const { url, anonKey } = await getSupabaseConfig();

    if (!url || !anonKey) {
      throw new Error(
        "Supabase is not configured yet. Set ff_supabase_url and ff_supabase_anon_key in chrome.storage.local."
      );
    }

    const endpoint = `${url.replace(/\/$/, "")}/auth/v1/signup`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = json?.msg || json?.message || json?.error_description || json?.error || res.statusText;
      throw new Error(message);
    }

    return json;
  }

  async function loadAuthModalHtml() {
    const url = chrome.runtime.getURL("content/auth-modal.html");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to load auth modal template");
    return res.text();
  }

  function removeExistingAuthModal() {
    const existing = document.getElementById("ff-auth-overlay");
    if (existing) existing.remove();
  }

  async function showSignupModal({ onAuthed, onGuest, onGoLogin } = {}) {
    removeExistingAuthModal();

    const html = await loadAuthModalHtml();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const overlay = doc.getElementById("ff-auth-overlay");

    if (!overlay) {
      throw new Error("Auth modal template missing #ff-auth-overlay");
    }

    document.body.appendChild(overlay);

    const modal = overlay.querySelector(".ff-auth-modal");
    const closeBtn = overlay.querySelector(".ff-auth-close");
    const form = overlay.querySelector("#ff-signup-form");
    const emailInput = overlay.querySelector("#ff-email");
    const passwordInput = overlay.querySelector("#ff-password");
    const emailError = overlay.querySelector("#ff-email-error");
    const passwordError = overlay.querySelector("#ff-password-error");
    const formError = overlay.querySelector("#ff-form-error");
    const formSuccess = overlay.querySelector("#ff-form-success");
    const submitBtn = overlay.querySelector("#ff-signup-button");
    const guestBtn = overlay.querySelector("#ff-guest");
    const goLoginBtn = overlay.querySelector("#ff-go-login");

    const closeModal = async ({ markSeen = true } = {}) => {
      if (markSeen) await markAuthPromptSeen();
      removeExistingAuthModal();
    };

    const clearMessages = () => {
      if (emailError) emailError.textContent = "";
      if (passwordError) passwordError.textContent = "";
      if (formError) formError.textContent = "";
      if (formSuccess) formSuccess.textContent = "";
    };

    const validate = () => {
      clearMessages();

      const email = String(emailInput?.value || "").trim();
      const password = String(passwordInput?.value || "");

      let ok = true;

      if (!isValidEmail(email)) {
        if (emailError) emailError.textContent = "Please enter a valid email address";
        ok = false;
      }

      if (password.length < 8) {
        if (passwordError) passwordError.textContent = "Password must be at least 8 characters";
        ok = false;
      }

      return { ok, email, password };
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };

    overlay.addEventListener("keydown", onKeyDown);

    closeBtn?.addEventListener("click", () => {
      closeModal();
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    guestBtn?.addEventListener("click", async () => {
      await setGuestMode();
      await closeModal();
      onGuest?.();
    });

    goLoginBtn?.addEventListener("click", async () => {
      await markAuthPromptSeen();
      onGoLogin?.();
      // Login modal is a later ticket.
      const globalErr = overlay.querySelector("#ff-form-error");
      if (globalErr) globalErr.textContent = "Login coming next. For now, please sign up or continue as guest.";
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { ok, email, password } = validate();
      if (!ok) return;

      setLoading(submitBtn, true);
      clearMessages();

      try {
        const result = await supabaseSignUp({ email, password });

        const session = result?.session || null;
        if (session) {
          await saveSession(session);
          if (formSuccess) formSuccess.textContent = "Welcome! Account created";
          await markAuthPromptSeen();
          setTimeout(async () => {
            removeExistingAuthModal();
            onAuthed?.(session);
          }, 2000);
        } else {
          // This usually means email confirmation is enabled in Supabase.
          if (formSuccess) {
            formSuccess.textContent = "Account created! Please check your email to confirm, then log in.";
          }
          await markAuthPromptSeen();
        }
      } catch (err) {
        const msg = normalizeErrorMessage(err?.message || String(err));
        if (formError) formError.textContent = msg;
      } finally {
        setLoading(submitBtn, false);
      }
    });

    // Initial focus
    if (modal) {
      focusFirstFocusable(modal);
    }
  }

  async function ensureAuthOrGuest({ forcePrompt = false, onAuthed, onGuest, onGoLogin } = {}) {
    const state = await getAuthState();

    if (state.isAuthenticated) return { ok: true, mode: "authenticated" };
    if (state.guest) return { ok: true, mode: "guest" };

    if (!forcePrompt) {
      const seen = await wasAuthPromptSeen();
      if (seen) return { ok: false, mode: "none" };
    }

    await showSignupModal({ onAuthed, onGuest, onGoLogin });
    return { ok: false, mode: "prompted" };
  }

  // Expose a small API to the existing content script.
  globalThis.FairFindzAuth = {
    STORAGE_KEYS,
    getAuthState,
    ensureAuthOrGuest,
    showSignupModal,
    markAuthPromptSeen
  };
})();
