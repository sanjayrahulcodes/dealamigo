/* DealAmigo landing — scroll reveal + nav shadow */
(function () {
  // Reveal-on-scroll
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  document.querySelectorAll(".reveal").forEach((el, i) => {
    // small stagger for groups sitting in the same viewport
    el.style.transitionDelay = Math.min(i % 4, 3) * 60 + "ms";
    io.observe(el);
  });

  // Nav gets a hairline once you scroll
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
})();
