(function () {
  try {
    var mode = localStorage.getItem("chatbot-theme");
    if (mode === "light" || mode === "dark") {
      document.documentElement.setAttribute("data-theme", mode);
    }
  } catch (error) {
    return;
  }
})();
