/**
 * Registers the hand-written service worker in public/service-worker.js.
 * Only runs in a production build and only over https (or localhost),
 * which is exactly where installing the app is possible anyway.
 */

const isLocalhost = Boolean(
  window.location.hostname === "localhost" ||
    window.location.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(window.location.hostname)
);

export function register() {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  const publicUrl = new URL(import.meta.env.BASE_URL.replace(/\/$/, "") || "", window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "") || ""}/service-worker.js`;

    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        registration.onupdatefound = () => {
          const installing = registration.installing;
          if (!installing) return;

          installing.onstatechange = () => {
            if (installing.state !== "installed") return;

            if (navigator.serviceWorker.controller) {
              // A newer build is ready; it takes over on the next visit.
              window.dispatchEvent(new CustomEvent("aurelia:update-ready"));
            } else {
              window.dispatchEvent(new CustomEvent("aurelia:ready-offline"));
            }
          };
        };
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });

    if (isLocalhost) {
      navigator.serviceWorker.ready.then(() => {
        console.log("Aurelia is cached and ready to work offline.");
      });
    }
  });
}

export function unregister() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((registration) => registration.unregister())
    .catch((error) => console.error(error.message));
}
