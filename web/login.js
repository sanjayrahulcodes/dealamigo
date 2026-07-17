/* DealAmigo login — role toggle + deep-link (?role=owner) + redirect.
   Auth is a stub for now: any submit proceeds. Buyers land on the shops
   directory; owners land in their shop's console. */
(function () {
  const params = new URLSearchParams(location.search);
  const buttons = [...document.querySelectorAll(".role-btn")];
  const title = document.querySelector(".auth-title");
  const sub = document.querySelector(".auth-sub");
  const quote = document.getElementById("asideQuote");
  const panel = document.getElementById("asidePanel");

  const COPY = {
    user: {
      title: "Welcome back",
      sub: "Log in to browse suppliers and negotiate.",
      quote: "“Bargain with local suppliers the way you always have — now with an AI that never sleeps.”",
      panel: [
        ["🗣️", "Negotiates in your language"],
        ["🏪", "Every supplier in one place"],
        ["🧾", "Instant receipt & WhatsApp handoff"],
      ],
    },
    owner: {
      title: "Owner sign-in",
      sub: "Log in to manage your shop and deals.",
      quote: "“Your own AI salesman — it bargains hard, but never below the floor you set.”",
      panel: [
        ["⚖️", "You set the floor price"],
        ["🙋", "One-tap deal approvals"],
        ["📊", "Live sales analytics"],
      ],
    },
  };

  let role = params.get("role") === "owner" ? "owner" : "user";

  function apply(r) {
    role = r;
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.role === r));
    const c = COPY[r];
    title.textContent = c.title;
    sub.textContent = c.sub;
    quote.textContent = c.quote;
    panel.innerHTML = c.panel
      .map(([ic, t]) => `<div class="ap-row"><span class="ap-ic">${ic}</span> ${t}</div>`)
      .join("");
  }

  // Stub "authentication": send buyers to the directory, owners to their shop.
  function proceed() {
    location.href = role === "owner" ? "shop/index.html" : "shops.html";
  }

  buttons.forEach((b) => b.addEventListener("click", () => apply(b.dataset.role)));
  document.querySelector(".auth-form").addEventListener("submit", (e) => {
    e.preventDefault();
    proceed();
  });
  document.querySelector(".google-btn").addEventListener("click", proceed);

  apply(role);
})();
