// Runs synchronously before first paint so pages never flash the wrong theme.
(function () {
  var pref = "system";
  try { pref = localStorage.getItem("sie.theme") || "system"; } catch (e) {}
  var dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
