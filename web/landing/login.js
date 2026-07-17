/* DealAmigo login — role toggle + deep-link (?role=owner). UI only. */
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

  function apply(role) {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.role === role));
    const c = COPY[role];
    title.textContent = c.title;
    sub.textContent = c.sub;
    quote.textContent = c.quote;
    panel.innerHTML = c.panel
      .map(([ic, t]) => `<div class="ap-row"><span class="ap-ic">${ic}</span> ${t}</div>`)
      .join("");
  }

  buttons.forEach((b) => b.addEventListener("click", () => apply(b.dataset.role)));
  apply(params.get("role") === "owner" ? "owner" : "user");
})();
