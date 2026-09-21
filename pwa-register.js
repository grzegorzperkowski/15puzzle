(() => {
  "use strict";
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const root = new URL(".", document.currentScript.src);
  let reloadForUpdate = false; let reloading = false; let controllerTried = false; let reloadTimer = 0;
  function reloadOnce() { if (!reloadForUpdate || reloading) return; reloading = true; window.clearTimeout(reloadTimer); window.location.reload(); }
  function showUpdate(registration) {
    if (!registration.waiting || document.querySelector("[data-pwa-update]")) return;
    const notice = document.createElement("aside");
    notice.dataset.pwaUpdate = "";
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;z-index:9999;right:1rem;bottom:1rem;display:flex;gap:.75rem;align-items:center;max-width:24rem;padding:.85rem 1rem;border-radius:.75rem;color:#fff;background:#17182d;box-shadow:0 8px 30px #0005;font:600 14px/1.3 system-ui";
    const text = document.createElement("span"); text.textContent = "Update available";
    const button = document.createElement("button"); button.type = "button"; button.textContent = "Reload";
    button.style.cssText = "border:0;border-radius:.5rem;padding:.55rem .75rem;font:inherit;cursor:pointer";
    button.addEventListener("click", () => { if (reloadForUpdate) return; reloadForUpdate = true; registration.waiting?.postMessage({ type: "SKIP_WAITING" }); button.disabled = true; window.clearTimeout(reloadTimer); reloadTimer = window.setTimeout(reloadOnce, 1000); });
    notice.append(text, button); document.body.append(notice);
  }
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloadForUpdate || reloading || controllerTried) return; controllerTried = true; window.addEventListener("pagehide", () => { reloading = true; window.clearTimeout(reloadTimer); }, { once: true }); window.location.reload(); });
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("service-worker.js", root), { scope: root.pathname, updateViaCache: "none" });
      showUpdate(registration);
      registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", () => showUpdate(registration)));
      await navigator.serviceWorker.ready;
      document.dispatchEvent(new CustomEvent("pwa:offline-ready"));
      document.querySelector("#offline-status")?.replaceChildren("Offline ready");
      registration.update().catch(() => {});
    } catch { document.dispatchEvent(new CustomEvent("pwa:offline-error")); }
  }, { once: true });
})();
