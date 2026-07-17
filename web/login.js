/* DealAmigo login — real email + Google auth via Supabase, plus role toggle.
   Buyers land on the shops directory; owners land in their shop console. */
import { supabase, getRole, homeForRole } from "./auth.js";

const params = new URLSearchParams(location.search);
const roleButtons = [...document.querySelectorAll(".role-btn")];
const title = document.querySelector(".auth-title");
const sub = document.querySelector(".auth-sub");
const quote = document.getElementById("asideQuote");
const panel = document.getElementById("asidePanel");
const form = document.getElementById("authForm");
const nameField = document.getElementById("nameField");
const submitBtn = document.getElementById("submitBtn");
const msg = document.getElementById("authMsg");
const modeToggle = document.getElementById("modeToggle");
const modeFoot = document.getElementById("modeFoot");
const googleBtn = document.querySelector(".google-btn");

const COPY = {
  user: {
    quote: "“Bargain with local suppliers the way you always have — now with an AI that never sleeps.”",
    panel: [["🗣️", "Negotiates in your language"], ["🏪", "Every supplier in one place"], ["🧾", "Instant receipt & WhatsApp handoff"]],
  },
  owner: {
    quote: "“Your own AI salesman — it bargains hard, but never below the floor you set.”",
    panel: [["⚖️", "You set the floor price"], ["🙋", "One-tap deal approvals"], ["📊", "Live sales analytics"]],
  },
};

let role = params.get("role") === "owner" ? "owner" : "user";
let mode = "login"; // or "signup"

function renderRole() {
  roleButtons.forEach((b) => b.classList.toggle("active", b.dataset.role === role));
  const c = COPY[role];
  quote.textContent = c.quote;
  panel.innerHTML = c.panel.map(([ic, t]) => `<div class="ap-row"><span class="ap-ic">${ic}</span> ${t}</div>`).join("");
}

function renderMode() {
  const signup = mode === "signup";
  nameField.hidden = !signup;
  submitBtn.textContent = signup ? "Create account" : "Log in";
  title.textContent = signup ? "Create your account" : role === "owner" ? "Owner sign-in" : "Welcome back";
  sub.textContent = signup ? "Join DealAmigo in seconds." : "Log in to keep dealing.";
  modeFoot.innerHTML = signup
    ? `Already have an account? <a href="#" class="auth-link" id="modeToggle">Log in</a>`
    : `New here? <a href="#" class="auth-link" id="modeToggle">Create an account</a>`;
  document.getElementById("modeToggle").addEventListener("click", toggleMode);
  hideMsg();
}

function toggleMode(e) {
  e.preventDefault();
  mode = mode === "login" ? "signup" : "login";
  renderMode();
}

function showMsg(text, kind = "err") {
  msg.textContent = text;
  msg.className = "auth-msg " + kind;
  msg.hidden = false;
}
function hideMsg() { msg.hidden = true; }

async function redirectHome() {
  location.href = homeForRole((await getRole()) || role);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMsg();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  submitBtn.disabled = true;
  submitBtn.textContent = "Please wait…";
  try {
    if (mode === "signup") {
      const full_name = document.getElementById("fullName").value.trim();
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { role, full_name } },
      });
      if (error) throw error;
      if (data.session) await redirectHome();
      else showMsg("Account created — check your email to confirm, then log in.", "ok");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await redirectHome();
    }
  } catch (err) {
    showMsg(err.message || "Something went wrong. Try again.");
  } finally {
    submitBtn.disabled = false;
    renderMode();
  }
});

googleBtn.addEventListener("click", async () => {
  const dest = homeForRole(role);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + "/" + dest },
  });
  if (error) showMsg(error.message);
});

roleButtons.forEach((b) => b.addEventListener("click", () => { role = b.dataset.role; renderRole(); renderMode(); }));
modeToggle.addEventListener("click", toggleMode);

// If already signed in, skip the form.
getRole().then((r) => { if (r) location.replace(homeForRole(r)); });

renderRole();
renderMode();
