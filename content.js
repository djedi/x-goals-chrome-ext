(() => {
  const ping = () => {
    try {
      chrome.runtime.sendMessage({ type: "xchrome-page-ready" });
    } catch {
      /* extension reloaded */
    }
  };
  ping();
  setInterval(ping, 60_000);
})();
