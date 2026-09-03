(() => {
  if (window.__XCHROME_HOOKED) return;
  window.__XCHROME_HOOKED = true;
  window.__XCHROME_CAPTURES = [];

  const interesting = /graphql|analytics|insights|premium/i;

  const save = (url, data) => {
    try {
      window.__XCHROME_CAPTURES.push({ url: String(url), data, t: Date.now() });
      if (window.__XCHROME_CAPTURES.length > 24) window.__XCHROME_CAPTURES.shift();
    } catch {
      /* ignore quota / circular */
    }
  };

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = async function xchromeFetch(...args) {
      const res = await origFetch.apply(this, args);
      try {
        const url = args[0] && args[0].url ? args[0].url : args[0];
        if (interesting.test(String(url))) {
          res
            .clone()
            .json()
            .then((data) => save(url, data))
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return res;
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function xchromeOpen(method, url, ...rest) {
    this.__xchromeUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function xchromeSend(...args) {
    this.addEventListener("load", function xchromeLoad() {
      try {
        const url = String(this.__xchromeUrl || "");
        if (interesting.test(url)) save(url, JSON.parse(this.responseText));
      } catch {
        /* ignore */
      }
    });
    return origSend.apply(this, args);
  };
})();
