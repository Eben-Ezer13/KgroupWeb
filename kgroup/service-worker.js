"use strict";

const CACHE_NAME = "kgroup-pwa-v2";
const APP_SHELL = [
  "./login.html",
  "./offline.html",
  "./style.css",
  "./api.js",
  "./data.js",
  "./dashboard.js",
  "./notifications.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];
const SCOPE_URL = new URL(self.registration.scope);
const API_PREFIX = new URL("api/", SCOPE_URL).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((asset) => new URL(asset, SCOPE_URL).href)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("kgroup-pwa-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== SCOPE_URL.origin) return;
  if (url.pathname.startsWith(API_PREFIX) || request.headers.has("authorization")) return;

  const hasQuery = Boolean(url.search);
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then(async (response) => {
        if (response.ok && !hasQuery) {
          try {
            await (await caches.open(CACHE_NAME)).put(request, response.clone());
          } catch (error) {
            console.warn("[KG PWA] Could not cache page:", error);
          }
        }
        return response;
      }).catch(async () => {
        if (!hasQuery) {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
        }
        const offline = await caches.match(new URL("./offline.html", SCOPE_URL).href);
        return offline || new Response("KGROUP est hors connexion.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      })
    );
    return;
  }

  if (hasQuery) return;
  event.respondWith(
    fetch(request).then(async (response) => {
      const type = response.headers.get("content-type") || "";
      if (response.ok && !type.includes("application/json")) {
        try {
          await (await caches.open(CACHE_NAME)).put(request, response.clone());
        } catch (error) {
          console.warn("[KG PWA] Could not cache asset:", error);
        }
      }
      return response;
    }).catch(async () => {
      const cachedAsset = await caches.match(request);
      return cachedAsset || Response.error();
    })
  );
});
