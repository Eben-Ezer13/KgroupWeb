/* =========================================================================
   KGROUP SALES PERFORMANCE PLATFORM — App Engine
   Vanilla JS. Handles layout injection, theming, charts (Canvas),
   counters, modals, toasts, tables, and page-specific rendering.
   ========================================================================= */
(function () {
  "use strict";
  const KG = window.KG || {};
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* -----------------------------------------------------------------------
     1. ICON LIBRARY  (inline SVG — professional, no external deps)
     Stroke icons drawn from a Feather-style set.
  ----------------------------------------------------------------------- */
  const IC = {
    grid:      '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    bag:       '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
    users:     '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    trophy:    '<path d="M6 9a6 6 0 0 0 12 0V3H6zM6 5H3a3 3 0 0 0 3 3M18 5h3a3 3 0 0 1-3 3M9 21h6M12 15v6"/>',
    flag:      '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    gift:      '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7"/>',
    chart:     '<path d="M3 3v18h18M7 15l3-4 3 3 4-6"/>',
    file:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6"/>',
    bell:      '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
    gear:      '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V22a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8 20.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 15a1.65 1.65 0 0 0-1.51-1H2a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 3.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.6 1.65 1.65 0 0 0 9 2.09V2a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 14 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 8c.14.31.22.66.22 1a1.65 1.65 0 0 0 1.29 1.51H22a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>',
    logout:    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    search:    '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    menu:      '<path d="M3 12h18M3 6h18M3 18h18"/>',
    // Repli de la barre laterale : glyphe « panneau lateral », volontairement
    // different du hamburger pour que les deux boutons ne se confondent pas.
    panel:     '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    sun:       '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
    moon:      '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    plus:      '<path d="M12 5v14M5 12h14"/>',
    check:     '<path d="M20 6 9 17l-5-5"/>',
    x:         '<path d="M18 6 6 18M6 6l12 12"/>',
    star:      '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    eye:       '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff:    '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-6.5 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22M9.9 9.9a3 3 0 1 0 4.2 4.2"/>',
    edit:      '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    trash:     '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    mail:      '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="m22 6-10 7L2 6"/>',
    lock:      '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    phone:     '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    card:      '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    cash:      '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    transfer:  '<path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>',
    calendar:  '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    print:     '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
    filter:    '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    arrowUp:   '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    sort:      '<path d="M8 6h13M8 12h9M8 18h5M3 8l3-3 3 3M6 5v14"/>',
    clock:     '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    dollar:    '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    zap:       '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    target:    '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    medal:     '<circle cx="12" cy="15" r="6"/><path d="M9 9 5 2M15 9l4-7M12 12l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L9 14.3l2-.3z"/>',
    link:      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    help:      '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    book:      '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>',
    heart:     '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21.2l7.7-7.8 1.1-1a5.5 5.5 0 0 0 0-7.8z"/>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>',
    hourglass: '<path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4"/>',
    sheet:     '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
    google:    '<path d="M22 12c0-.6-.05-1.2-.15-1.8H12v3.6h5.6a4.8 4.8 0 0 1-2.08 3.15v2.6h3.36C20.85 17.9 22 15.25 22 12z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.36-2.6c-.93.62-2.12.98-3.26.98-2.5 0-4.62-1.69-5.38-3.96H3.16v2.68A10 10 0 0 0 12 22z" fill="#34A853" stroke="none"/><path d="M6.62 13.99a6 6 0 0 1 0-3.83V7.48H3.16a10 10 0 0 0 0 9.04z" fill="#FBBC05" stroke="none"/><path d="M12 5.4c1.47 0 2.79.51 3.82 1.5l2.85-2.85C16.95 2.42 14.7 1.5 12 1.5A10 10 0 0 0 3.16 7.48l3.46 2.68C7.38 7.9 9.5 5.4 12 5.4z" fill="#EA4335" stroke="none"/>',
  };
  function icon(name, cls) {
    const raw = IC[name] || IC.grid;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="${cls||""}">${raw}</svg>`;
  }
  window.icon = icon;

  // Official KGROUP Parfumery seal
  const LOGO = `<img class="logo-mark" src="assets/images/logo.jpeg" alt="KGROUP Parfumery"/>`;
  window.KG_LOGO = LOGO;

  /* -----------------------------------------------------------------------
     1b. INTERNATIONALISATION (i18n) — English / French, persisted
     Elements opt in with data-i18n="key" (text) or data-i18n-ph="key"
     (placeholder). Add languages by extending DICT.
  ----------------------------------------------------------------------- */
  const DICT = {
    en: {
      "nav.dashboard":"Dashboard","nav.sales":"New Preorder","nav.salespersons":"Salespersons",
      "nav.ranking":"Rankings","nav.challenges":"Challenges","nav.rewards":"Rewards",
      "nav.reports":"Reports","nav.notifications":"Notifications","nav.settings":"Settings","nav.logout":"Logout",
      "nav.formation":"Training","nav.clients":"Clients","nav.remuneration":"Payroll","nav.history":"Sales follow-up","nav.guide":"Guide",
      "nav.messages":"Team messages",
      "messages.heading":"Messages","messages.intro":"Chat with the whole platform or privately with any member.",
      "messages.conversations":"Conversations","messages.team":"Company group","messages.teamHint":"Everyone in the company can read these messages.",
      "messages.placeholder":"Write a message…","messages.send":"Send",
      "messages.replying":"Replying to","messages.composeHint":"Type @ to mention someone · Enter to send · Shift + Enter for a new line",
      "messages.privacyHint":"Private messages are visible only to their participants.",
      "messages.older":"Load earlier messages",
      "group.main":"Main","group.insights":"Insights","group.system":"System",
      "topbar.search":"Search anything…","lang.title":"Language","topbar.collapse":"Collapse sidebar",
      "greeting.morning":"Good morning","common.viewAll":"View all",
      "btn.newSale":"New Preorder","btn.export":"Export","btn.addSalesperson":"Add Salesperson",
      "btn.registerSale":"Register Preorder","btn.createChallenge":"Create Challenge",
      "head.dashboard.sub":"Here's what's happening across KGROUP Parfumery today.",
      "head.messages.t":"Team messages",
      "head.sales.t":"New Preorder","head.sales.sub":"Record a reservation; create the sale only after delivery and full payment.",
      "head.salespersons.t":"Salespersons","head.salespersons.sub":"Manage your luxury fragrance sales team",
      "head.ranking.t":"Rankings 🏆","head.ranking.sub":"Celebrate your top performers across every timeframe.",
      "head.challenges.t":"Challenges 🚩","head.challenges.sub":"Gamified competitions that keep your team hungry and motivated.",
      "head.reports.t":"Reports & Analytics","head.reports.sub":"Deep-dive into KGROUP's performance and export polished reports.",
      "sec.salesPerf":"Sales Performance","sec.salesPerf.sub":"Revenue & units over the last 12 months",
      "sec.quickActions":"Quick Actions","sec.top10":"Top 10 Salespersons","sec.top10.sub":"By revenue this month",
      "sec.recent":"Recent Sales","sec.recent.sub":"Latest transactions","sec.notifications":"Latest Notifications",
      "notif.title":"Notifications","notif.markAll":"Mark all read","notif.empty":"No notifications yet",
      "notif.newSale":"New sale","notif.newChallenge":"New challenge","notif.by":"by","notif.active":"Active",
      "notif.allRead":"All caught up","notif.allRead.msg":"Notifications marked as read.",
      "sec.category":"Sales by Category","sec.monthlyTarget":"Monthly Target",
      "empty.noReps":"No salespersons yet — add your team to start tracking performance.",
      "empty.noSales":"No sales registered yet — your data will appear here.",
    },
    fr: {
      "nav.dashboard":"Tableau de bord","nav.sales":"Nouvelle précommande","nav.salespersons":"Vendeurs",
      "nav.ranking":"Classements","nav.challenges":"Défis","nav.rewards":"Récompenses",
      "nav.reports":"Rapports","nav.notifications":"Notifications","nav.settings":"Paramètres","nav.logout":"Déconnexion",
      "nav.formation":"Formation","nav.clients":"Clients","nav.remuneration":"Rémunération","nav.history":"Suivi des ventes","nav.guide":"Guide",
      "nav.messages":"Messagerie",
      "messages.heading":"Messagerie","messages.intro":"Discutez avec toute la plateforme ou en privé avec un membre.",
      "messages.conversations":"Conversations","messages.team":"Groupe de l'entreprise","messages.teamHint":"Toutes les personnes de l'entreprise peuvent lire ces messages.",
      "messages.placeholder":"Écrivez un message…","messages.send":"Envoyer",
      "messages.replying":"Réponse à","messages.composeHint":"Tapez @ pour mentionner quelqu'un · Entrée pour envoyer · Maj + Entrée pour aller à la ligne",
      "messages.privacyHint":"Les messages privés ne sont visibles que par leurs participants.",
      "messages.older":"Charger les messages précédents",
      "group.main":"Principal","group.insights":"Analyses","group.system":"Système",
      "topbar.search":"Rechercher…","lang.title":"Langue","topbar.collapse":"Replier le menu",
      "greeting.morning":"Bonjour","common.viewAll":"Voir tout",
      "btn.newSale":"Nouvelle précommande","btn.export":"Exporter","btn.addSalesperson":"Ajouter un vendeur",
      "btn.registerSale":"Enregistrer la précommande","btn.createChallenge":"Créer un défi",
      "head.dashboard.sub":"Voici l'activité de KGROUP Parfumery aujourd'hui.",
      "head.messages.t":"Messagerie",
      "head.sales.t":"Nouvelle précommande","head.sales.sub":"Enregistrez une réservation; la vente sera créée après livraison et paiement complet.",
      "head.salespersons.t":"Vendeurs","head.salespersons.sub":"Gérez votre équipe de vente de parfums de luxe",
      "head.ranking.t":"Classements 🏆","head.ranking.sub":"Mettez à l'honneur vos meilleurs vendeurs sur chaque période.",
      "head.challenges.t":"Défis 🚩","head.challenges.sub":"Des compétitions ludiques qui motivent votre équipe.",
      "head.reports.t":"Rapports & Analyses","head.reports.sub":"Analysez la performance de KGROUP et exportez des rapports soignés.",
      "sec.salesPerf":"Performance des ventes","sec.salesPerf.sub":"Revenus et unités sur les 12 derniers mois",
      "sec.quickActions":"Actions rapides","sec.top10":"Top 10 des vendeurs","sec.top10.sub":"Par revenu ce mois-ci",
      "sec.recent":"Ventes récentes","sec.recent.sub":"Dernières transactions","sec.notifications":"Dernières notifications",
      "notif.title":"Notifications","notif.markAll":"Tout marquer comme lu","notif.empty":"Aucune notification pour le moment",
      "notif.newSale":"Nouvelle vente","notif.newChallenge":"Nouveau challenge","notif.by":"par","notif.active":"En cours",
      "notif.allRead":"Tout est lu","notif.allRead.msg":"Notifications marquées comme lues.",
      "sec.category":"Ventes par catégorie","sec.monthlyTarget":"Objectif mensuel",
      "empty.noReps":"Aucun vendeur — ajoutez votre équipe pour suivre la performance.",
      "empty.noSales":"Aucune vente enregistrée — vos données apparaîtront ici.",
    },
  };
  const KGI18N = {
    lang: localStorage.getItem("kg-lang") || "en",
    langs: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }],
    t(key) { return (DICT[this.lang] && DICT[this.lang][key]) || DICT.en[key] || key; },
    apply(root) {
      root = root || document;
      root.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = this.t(el.getAttribute("data-i18n")); });
      root.querySelectorAll("[data-i18n-ph]").forEach(el => { el.setAttribute("placeholder", this.t(el.getAttribute("data-i18n-ph"))); });
    },
    set(lang) {
      this.lang = lang; localStorage.setItem("kg-lang", lang);
      document.documentElement.setAttribute("lang", lang);
      this.apply(document);
      const lc = document.getElementById("langCode");   // keep the top-bar label in sync
      if (lc) lc.textContent = lang.toUpperCase();
      window.dispatchEvent(new Event("kg:lang"));
    },
  };
  document.documentElement.setAttribute("lang", KGI18N.lang);
  window.KGI18N = KGI18N;
  const t = (k) => KGI18N.t(k);

  function initPwa() {
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./service-worker.js")
        .catch((error) => console.warn("[KG PWA] Service worker registration failed:", error));
    }

    let installEvent = null;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    const dismissed = () => {
      try { return sessionStorage.getItem("kg-pwa-install-dismissed") === "1"; }
      catch (error) {
        console.warn("[KG PWA] Could not read install prompt preference:", error);
        return false;
      }
    };
    let panel = null;
    let instructions = null;

    function renderInstallPrompt() {
      if ((!installEvent && !isIos) || isStandalone() || dismissed() || !document.body) {
        if (panel) panel.remove();
        panel = null;
        return;
      }
      if (!panel) {
        panel = document.createElement("aside");
        panel.className = "pwa-install-banner";
        panel.setAttribute("aria-label", "KGROUP app installation");
        const copy = document.createElement("div");
        copy.className = "pwa-install-copy";
        const title = document.createElement("strong");
        title.className = "pwa-install-title";
        const description = document.createElement("span");
        description.className = "pwa-install-description";
        instructions = document.createElement("span");
        instructions.className = "pwa-install-instructions hidden";
        instructions.setAttribute("role", "status");
        copy.append(title, description, instructions);
        const actions = document.createElement("div");
        actions.className = "pwa-install-actions";
        const installButton = document.createElement("button");
        installButton.type = "button";
        installButton.className = "btn btn-primary btn-sm pwa-install-action";
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "icon-btn pwa-install-close";
        closeButton.textContent = "×";
        closeButton.setAttribute("aria-label", "Dismiss install prompt");
        installButton.addEventListener("click", async () => {
          if (!installEvent) {
            instructions.textContent = KGI18N.lang === "fr"
              ? "Dans Safari, touchez Partager, puis « Sur l’écran d’accueil »."
              : "In Safari, tap Share, then “Add to Home Screen”.";
            instructions.classList.remove("hidden");
            return;
          }
          const prompt = installEvent;
          installEvent = null;
          try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice.outcome === "accepted") panel.remove();
            else renderInstallPrompt();
          } catch (error) {
            console.warn("[KG PWA] Install prompt failed:", error);
            instructions.textContent = KGI18N.lang === "fr"
              ? "L’installation n’a pas pu démarrer. Utilisez le menu de votre navigateur pour ajouter KGROUP à l’écran d’accueil."
              : "Installation could not start. Use your browser menu to add KGROUP to your home screen.";
            instructions.classList.remove("hidden");
          }
        });
        closeButton.addEventListener("click", () => {
          try { sessionStorage.setItem("kg-pwa-install-dismissed", "1"); }
          catch (error) { console.warn("[KG PWA] Could not save install prompt preference:", error); }
          panel.remove();
          panel = null;
        });
        actions.append(installButton, closeButton);
        panel.append(copy, actions);
        document.body.append(panel);
      }

      const french = KGI18N.lang === "fr";
      panel.querySelector(".pwa-install-title").textContent = french ? "Installer KGROUP" : "Install KGROUP";
      panel.querySelector(".pwa-install-description").textContent = french
        ? "Retrouvez votre espace sur l’écran d’accueil."
        : "Keep your workspace on your home screen.";
      panel.querySelector(".pwa-install-action").textContent = isIos
        ? (french ? "Comment faire" : "How to")
        : (french ? "Installer" : "Install");
      panel.querySelector(".pwa-install-close").setAttribute("aria-label", french ? "Fermer" : "Dismiss install prompt");
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      if (document.body.hasAttribute("data-app")) return;
      event.preventDefault();
      installEvent = event;
      renderInstallPrompt();
    });
    window.addEventListener("appinstalled", () => {
      installEvent = null;
      if (panel) panel.remove();
      panel = null;
    });
    window.addEventListener("kg:lang", renderInstallPrompt);
    if (isIos && !document.body.hasAttribute("data-app")) renderInstallPrompt();
  }
  initPwa();

  /* -----------------------------------------------------------------------
     1c. GUIDED TUTORIAL — role-aware, bilingual (follows the language switch)
     Auto-opens once for new users; reopen anytime via the "?" top-bar button.
  ----------------------------------------------------------------------- */
  const TUTORIAL = {
    admin: [
      { icon: "👋",
        en: { t: "Welcome to KGROUP", b: "This is your sales-performance platform. In under a minute you'll know how to manage your team, track sales, and run challenges. Use the arrows to move through the tour." },
        fr: { t: "Bienvenue sur KGROUP", b: "Voici votre plateforme de performance des ventes. En moins d'une minute, vous saurez gérer votre équipe, suivre les ventes et lancer des défis. Utilisez les flèches pour parcourir le guide." } },
      { icon: "👥",
        en: { t: "Add your team", b: "Open Salespersons → Add Salesperson. After saving, copy the personal invite link and send it (WhatsApp, e-mail…). Your rep opens it, sets a password, and joins your team automatically. You can re-copy the link anytime from the row's link icon." },
        fr: { t: "Ajoutez votre équipe", b: "Ouvrez Vendeurs → Ajouter un vendeur. Après l'enregistrement, copiez le lien d'invitation personnel et envoyez-le (WhatsApp, e-mail…). Votre vendeur l'ouvre, définit un mot de passe et rejoint automatiquement votre équipe. Vous pouvez recopier le lien à tout moment via l'icône de lien de la ligne." } },
      { icon: "🛍️",
        en: { t: "Register a sale", b: "In Sales, pick the customer, product (30 / 50 / 100 ml) and payment method (Espèces, Virement, Mobile Money). The commission (5 / 8 / 15 DHS) is calculated for you, and every sale updates rankings and XP instantly." },
        fr: { t: "Enregistrer une vente", b: "Dans Ventes, choisissez le client, le produit (30 / 50 / 100 ml) et le mode de paiement (Espèces, Virement, Mobile Money). La commission (5 / 8 / 15 DHS) est calculée automatiquement, et chaque vente met à jour les classements et l'XP instantanément." } },
      { icon: "📊",
        en: { t: "Track performance", b: "The Dashboard shows total sales, revenue and your Top 10 — all built from real sales. Rankings move as your team sells. The Reports page adds charts and exports." },
        fr: { t: "Suivez la performance", b: "Le Tableau de bord affiche les ventes totales, le chiffre d'affaires et votre Top 10 — le tout basé sur les ventes réelles. Les classements évoluent au rythme des ventes. La page Rapports ajoute graphiques et exports." } },
      { icon: "🚩",
        en: { t: "Launch challenges", b: "In Challenges → Create Challenge, set a title, a reward and a target. Your whole team sees it and competes for the reward you choose." },
        fr: { t: "Lancez des défis", b: "Dans Défis → Créer un défi, définissez un titre, une récompense et un objectif. Toute votre équipe le voit et se dispute la récompense que vous choisissez." } },
      { icon: "🎁",
        en: { t: "Rewards & bonuses", b: "The Rewards page lists the monthly bonuses from your contract: 20 sales → 100 DHS, 40 → 300, 60 → 600, plus promo codes and free perfumes." },
        fr: { t: "Récompenses & bonus", b: "La page Récompenses liste les bonus mensuels de votre contrat : 20 ventes → 100 DHS, 40 → 300, 60 → 600, ainsi que des codes promo et des parfums offerts." } },
      { icon: "⚙️",
        en: { t: "Settings & language", b: "In Settings you can edit your profile and theme. Switch language (EN / FR) anytime with the language button in the top bar. You're ready — enjoy!" },
        fr: { t: "Paramètres & langue", b: "Dans Paramètres, modifiez votre profil et le thème. Changez de langue (EN / FR) à tout moment via le bouton langue en haut. Vous êtes prêt — profitez-en !" } },
    ],
    salesperson: [
      { icon: "👋",
        en: { t: "Welcome to your dashboard", b: "This is your personal space to track your sales, climb the rankings and earn rewards. Let's take a quick tour." },
        fr: { t: "Bienvenue sur votre tableau de bord", b: "Voici votre espace personnel pour suivre vos ventes, grimper dans les classements et gagner des récompenses. Faisons un tour rapide." } },
      { icon: "🏅",
        en: { t: "Level, XP & badges", b: "Every sale earns XP and levels you up (Rookie → Diamond). You unlock badges for milestones — your first sale, 50 sales, and more." },
        fr: { t: "Niveau, XP & badges", b: "Chaque vente rapporte de l'XP et vous fait monter de niveau (Rookie → Diamond). Vous débloquez des badges pour des étapes clés — votre première vente, 50 ventes, et plus." } },
      { icon: "🛍️",
        en: { t: "Register your sales", b: "Go to Sales to log a sale: customer, product and payment method. Sales are registered under your name — and each one boosts your XP and ranking." },
        fr: { t: "Enregistrez vos ventes", b: "Allez dans Ventes pour enregistrer une vente : client, produit et mode de paiement. Les ventes sont enregistrées à votre nom — et chacune augmente votre XP et votre classement." } },
      { icon: "💸",
        en: { t: "How you earn", b: "You earn a commission on every sale (30 ml → 5 DHS, 50 ml → 8, 100 ml → 15) plus monthly bonuses (20 sales → 100 DHS, 40 → 300, 60 → 600). Track them on your dashboard." },
        fr: { t: "Comment vous gagnez", b: "Vous gagnez une commission sur chaque vente (30 ml → 5 DHS, 50 ml → 8, 100 ml → 15) plus des bonus mensuels (20 ventes → 100 DHS, 40 → 300, 60 → 600). Suivez-les sur votre tableau de bord." } },
      { icon: "🏆",
        en: { t: "Compete & win", b: "Check Rankings to see where you stand, and Challenges for competitions with extra rewards. Sell more to climb the leaderboard!" },
        fr: { t: "Rivalisez & gagnez", b: "Consultez Classements pour voir votre position, et Défis pour des compétitions avec des récompenses supplémentaires. Vendez plus pour grimper dans le classement !" } },
      { icon: "⚙️",
        en: { t: "Settings & language", b: "In Settings you can update your profile and switch language (EN / FR) with the language button in the top bar. You're all set — good luck!" },
        fr: { t: "Paramètres & langue", b: "Dans Paramètres, mettez à jour votre profil et changez la langue (EN / FR) via le bouton langue en haut. Tout est prêt — bonne chance !" } },
    ],
  };
  const TUT_L = {
    en: { next: "Next", back: "Back", done: "Got it!", skip: "Skip tour", step: "Step", help: "How to use the site" },
    fr: { next: "Suivant", back: "Retour", done: "Compris !", skip: "Passer", step: "Étape", help: "Comment utiliser le site" },
  };
  const tutL = (k) => (TUT_L[KGI18N.lang] || TUT_L.en)[k];

  const PAGE_TOURS = {
    dashboard: [
      { selector: ["#kSales", "#sToday", "#heroLevel"], icon: "📊", en: ["Understand your activity cards", "Administrators see team-wide units, revenue, and active salesperson totals. A salesperson sees personal daily/monthly results and their level. These figures follow recorded, validated activity; an unvalidated preorder is not a completed sale."], fr: ["Comprendre les indicateurs d'activité", "L'administrateur voit les unités, le chiffre d'affaires et les commerciaux actifs de l'équipe. Le commercial voit ses résultats du jour et du mois ainsi que son niveau. Ces chiffres suivent l'activité enregistrée et validée; une précommande non validée n'est pas une vente finalisée."] },
      { selector: ["#mainChart", "#perfChart", "#xpFill"], icon: "📈", en: ["Read your progress", "The administrator chart compares team revenue and units for the period selected above it. A salesperson chart shows personal units over the last seven days, and the level bar shows experience progress. Hover or tap chart points for their values."], fr: ["Lire votre progression", "Le graphique administrateur compare le chiffre d'affaires et les unités de l'équipe sur la période choisie. Le graphique commercial montre ses unités des sept derniers jours; la barre de niveau indique son expérience. Survolez ou touchez les points du graphique pour voir leurs valeurs."] },
      { selector: ["#targetLine", "#targetRing"], icon: "🎯", en: ["Check the monthly target", "This panel compares the recorded result with the monthly target and shows what remains. It is a progress indicator, not a new order form; use New preorder to record a customer reservation."], fr: ["Vérifier l'objectif mensuel", "Ce panneau compare le résultat enregistré à l'objectif mensuel et indique ce qu'il reste à atteindre. C'est un indicateur de progression, pas un formulaire de commande; utilisez Nouvelle précommande pour enregistrer une réservation client."] },
      { selector: ["#topList", "#sRank"], icon: "🏆", en: ["Understand the ranking", "Administrators see the leading salespeople; a salesperson sees their current position. The ranking compares recorded results and does not list unpaid orders. Open Sales follow-up to inspect transactions."], fr: ["Comprendre le classement", "L'administrateur voit les meilleurs commerciaux; chaque commercial voit sa position. Le classement compare les résultats enregistrés et ne liste pas les commandes impayées. Ouvrez le Suivi des ventes pour examiner les opérations."] },
      { selector: ["#recentFeed", "#activity"], icon: "🧾", en: ["Review recent activity", "This feed highlights recent sales or account activity. For complete history, search filters, preorder status, or delivery/payment actions, open Sales follow-up."], fr: ["Consulter l'activité récente", "Ce fil présente les dernières ventes ou activités du compte. Pour l'historique complet, les filtres, les statuts de précommande ou les actions de livraison et paiement, ouvrez le Suivi des ventes."] },
      { selector: ["#exportBtn"], icon: "📥", en: ["Export dashboard data", "The administrator can open this menu to download the dashboard's recent sales data in an available format. For a date-filtered analysis or a full PDF, use Reports instead."], fr: ["Exporter les données du tableau de bord", "L'administrateur ouvre ce menu pour télécharger les données récentes du tableau de bord dans un format disponible. Pour analyser une période ou obtenir un rapport PDF complet, utilisez plutôt Rapports."] },
      { selector: ["#notifBlock"], icon: "🔔", en: ["Check notifications", "Review recent alerts and use their links to open the relevant page. A notification informs you about activity; use the destination page to review or act on the underlying record."], fr: ["Consulter les notifications", "Lisez les alertes récentes et utilisez leurs liens pour ouvrir la page concernée. Une notification signale une activité; consultez ou modifiez l'opération depuis la page correspondante."] },
    ],
    sales: [
      { selector: ["#customer", "#clientPhone"], icon: "👤", en: ["Identify the customer", "The customer's name is required. Add their phone number to match or create a client record; birthday is optional. When an existing customer is suggested, select that record so the preorder stays linked to their history."], fr: ["Identifier le client", "Le nom du client est obligatoire. Ajoutez son téléphone pour retrouver ou créer sa fiche; la date d'anniversaire est facultative. Si un client existant est proposé, sélectionnez sa fiche pour relier la précommande à son historique."] },
      { selector: ["#rep", "#perfumeName", "#product"], icon: "🌸", en: ["Choose the salesperson and product", "Select who receives credit for this order, enter or select the perfume name, then choose its format. The catalog supplies the unit price; do not use this form to change a product's price."], fr: ["Choisir le commercial et le produit", "Sélectionnez le commercial auquel l'opération sera attribuée, saisissez ou choisissez le parfum, puis sélectionnez son format. Le catalogue fixe le prix unitaire : ce formulaire ne sert pas à modifier le prix d'un produit."] },
      { selector: ["#qty", "#deposit", "#expectedAt"], icon: "🧾", en: ["Set quantity, deposit, and expected delivery", "Enter a quantity of at least one. For a preorder, record only the deposit actually received and set an expected delivery date if known. The remaining balance is calculated from the total; it is not another payment."], fr: ["Indiquer quantité, acompte et livraison prévue", "Saisissez une quantité d'au moins une unité. Pour une précommande, indiquez uniquement l'acompte réellement reçu et la date de livraison prévue si elle est connue. Le reste à payer est calculé à partir du total : ce n'est pas un nouvel encaissement."] },
      { selector: ['label[for="payCash"]', 'label[for="payTransfer"]', 'label[for="payMobile"]'], icon: "💳", en: ["Record the payment method", "Choose the method used for the payment or deposit being recorded. This selection does not mark a preorder as fully paid by itself."], fr: ["Indiquer le mode de paiement", "Choisissez le moyen utilisé pour le paiement ou l'acompte enregistré. Ce choix, à lui seul, ne marque pas une précommande comme entièrement payée."] },
      { selector: ["#saleForm button[type=submit]"], icon: "✅", en: ["Save, then complete the workflow", "Saving creates a preorder. It does not add a sale or commission yet. In Sales follow-up, update delivery and payment as they happen, then validate the preorder as a sale only after the customer has received the product and paid in full."], fr: ["Enregistrer, puis terminer le parcours", "L'enregistrement crée une précommande, pas encore une vente ni une commission. Dans le Suivi des ventes, mettez à jour la livraison et le paiement au fur et à mesure, puis validez la précommande en vente uniquement après remise du produit et paiement complet."] },
    ],
    history: [
      { selector: ["#tabs"], icon: "🔀", en: ["Switch between sales and preorders", "Sales contains completed transactions. Preorders contains reservations that still need delivery, payment, validation, or cancellation. Switching tabs changes which records and summary totals are shown."], fr: ["Passer des ventes aux précommandes", "L'onglet Ventes contient les opérations finalisées. L'onglet Précommandes contient les réservations qui attendent encore une livraison, un paiement, une validation ou une annulation. Le changement d'onglet modifie les dossiers et les totaux affichés."] },
      { selector: ["#fRep", "#fPeriod", "#fSearch"], icon: "🔎", en: ["Narrow the results", "Combine the salesperson, period, and text filters to find matching records. Search accepts customer or perfume details; reset filters to return to the full list. The totals update to match the current view."], fr: ["Affiner les résultats", "Combinez le filtre commercial, la période et la recherche textuelle. Recherchez un client ou un parfum; réinitialisez les filtres pour retrouver toute la liste. Les totaux suivent les résultats affichés."] },
      { selector: ["#exportBar"], icon: "📥", en: ["Export the current view", "Choose an available format to download the records currently selected by the tab and filters. Check the period and salesperson filters before exporting."], fr: ["Exporter la vue affichée", "Choisissez un format disponible pour télécharger les opérations correspondant à l'onglet et aux filtres actifs. Vérifiez la période et le commercial avant l'export."] },
      { selector: ["#statusChips"], icon: "🧭", en: ["Filter preorders by workflow status", "These chips separate pending, delivered, paid, validated, and cancelled preorders. Choose All to include every status. A status filter only changes the list; use the action on a preorder row to record an actual workflow change."], fr: ["Filtrer les précommandes par statut", "Ces boutons séparent les précommandes en attente, livrées, payées, validées et annulées. Choisissez Toutes pour tout afficher. Un filtre ne modifie pas une précommande : utilisez l'action de sa ligne pour enregistrer un changement réel."] },
      { selector: ["#preBody", "#tabSales"], icon: "🔄", en: ["Update a preorder safely", "Record delivery and each payment when they occur. A paid preorder is still not a sale: use its validation action only when delivery and full payment are complete. Cancellation is for a reservation that will not proceed."], fr: ["Mettre à jour une précommande", "Enregistrez la livraison et chaque paiement lorsqu'ils ont lieu. Une précommande payée n'est pas encore une vente : utilisez l'action de validation uniquement lorsque la livraison et le paiement complet sont confirmés. Annulez uniquement une réservation abandonnée."] },
    ],
    salespersons: [
      { selector: ["#repSearch", "#cityFilter"], icon: "🔎", en: ["Find a salesperson", "Search by the available name or contact details, then use the city filter to narrow the roster. Clear both filters to restore the complete team list."], fr: ["Retrouver un commercial", "Recherchez avec les informations disponibles sur le nom ou les coordonnées, puis filtrez par ville. Effacez les deux filtres pour réafficher toute l'équipe."] },
      { selector: ['[data-modal-open="#addModal"]'], icon: "➕", en: ["Create a team profile", "Enter the salesperson's details and save to add them to the roster. The generated invitation is how they create or connect their login; adding a roster entry does not sign them in automatically."], fr: ["Créer une fiche d'équipe", "Saisissez les coordonnées du commercial et enregistrez pour l'ajouter à la liste. L'invitation générée lui permet de créer ou relier son accès; l'ajout d'une fiche ne le connecte pas automatiquement."] },
      { selector: ["#repTable"], icon: "👥", en: ["Open and manage a profile", "Select a row to inspect that member's contact and performance details and the actions available to your role. Confirm the selected person before saving any edit or removal."], fr: ["Ouvrir et gérer une fiche", "Sélectionnez une ligne pour consulter les coordonnées, les résultats et les actions permises par votre rôle. Vérifiez le nom du commercial avant d'enregistrer une modification ou une suppression."] },
    ],
    ranking: [
      { selector: ["#periodSeg"], icon: "🗓️", en: ["Choose the comparison period", "Switch between the available timeframes. The podium and full list both recalculate for the selected period; changing this view does not change or record sales."], fr: ["Choisir la période de comparaison", "Passez d'une période disponible à l'autre. Le podium et la liste complète sont recalculés pour la période choisie; ce réglage ne modifie et n'enregistre aucune vente."] },
      { selector: ["#podium"], icon: "🥇", en: ["Read the top three", "The podium highlights the three highest results for the selected period. If fewer members have results, empty positions may remain; consult the list below for everyone else."], fr: ["Lire le podium", "Le podium met en avant les trois meilleurs résultats de la période sélectionnée. S'il y a moins de trois résultats, certaines places restent vides; la liste en dessous présente les autres membres."] },
      { selector: ["#board"], icon: "📋", en: ["Review the complete ranking", "The list compares all displayed team members using the same period and measure as the podium. Rankings reflect recorded sales, not unvalidated preorders."], fr: ["Consulter le classement complet", "La liste compare les membres affichés avec la même période et le même indicateur que le podium. Le classement repose sur les ventes enregistrées, pas sur les précommandes non validées."] },
    ],
    challenges: [
      { selector: ['[data-modal-open="#newChallenge"]'], icon: "🚩", en: ["Set up a team challenge", "Give the challenge a clear name, measurable target, active dates, and reward. Check the dates and units before saving; the challenge motivates the team but does not itself create a sale or change commission."], fr: ["Créer un défi d'équipe", "Donnez au défi un nom clair, un objectif mesurable, une période et une récompense. Vérifiez les dates et les unités avant d'enregistrer; le défi motive l'équipe, mais ne crée pas une vente et ne modifie pas une commission."] },
      { selector: ["#challengeGrid"], icon: "🎯", en: ["Track each challenge", "Each card shows the goal, time window, reward, and progress recorded so far. Compare progress with the stated target; only validated sales contribute to sales-based goals."], fr: ["Suivre chaque défi", "Chaque carte indique l'objectif, la période, la récompense et la progression enregistrée. Comparez la progression à la cible indiquée; seules les ventes validées alimentent les objectifs liés aux ventes."] },
      { selector: ["#chBoard"], icon: "🏅", en: ["Understand the challenge ranking", "This section compares team contributions to the current challenge. It is separate from the general sales ranking and reflects only the measure shown for the challenge."], fr: ["Comprendre le classement du défi", "Cette section compare les contributions au défi en cours. Elle est distincte du classement général des ventes et utilise uniquement l'indicateur indiqué pour ce défi."] },
    ],
    rewards: [
      { selector: ["#rewardsGrid"], icon: "🎁", en: ["Read the reward tiers", "Each card describes the monthly performance threshold and the bonus or reward attached to it. Compare your validated results with the stated threshold; a preorder that has not been validated does not count as a completed sale."], fr: ["Lire les paliers de récompense", "Chaque carte décrit le seuil mensuel à atteindre et le bonus ou la récompense correspondante. Comparez vos résultats validés au seuil indiqué; une précommande non validée ne compte pas comme vente finalisée."] },
      { selector: ["#challengeGrid"], icon: "🚩", en: ["Distinguish challenges from rewards", "Team challenges are shared goals with a time window and progress display. The reward tiers below are monthly contract rewards; they are separate systems and may use different eligibility rules."], fr: ["Distinguer défis et récompenses", "Les défis d'équipe sont des objectifs collectifs avec une période et une progression. Les paliers de récompense ci-dessous sont les récompenses mensuelles du contrat; ce sont deux dispositifs distincts qui peuvent avoir des règles différentes."] },
    ],
    clients: [
      { selector: ["#fSearch"], icon: "🔎", en: ["Find a client", "Search by the client's name or phone number. Clear the field to restore all matching records; the search does not create or edit a client."], fr: ["Retrouver un client", "Recherchez par nom ou numéro de téléphone. Effacez le champ pour réafficher toutes les fiches correspondantes; la recherche ne crée et ne modifie aucune fiche."] },
      { selector: ["#fRep", "#fMonth"], icon: "🧰", en: ["Filter the client portfolio", "Combine the salesperson filter with the birthday month filter to narrow the list. These filters only change which records are shown; they do not reassign the client."], fr: ["Filtrer le portefeuille client", "Combinez le filtre par commercial et celui du mois d'anniversaire pour réduire la liste. Ces filtres changent uniquement les fiches affichées; ils ne réattribuent pas le client."] },
      { selector: ['[data-modal-open="#newClient"]'], icon: "➕", en: ["Create a client record", "Enter the customer's contact information and any optional notes. Set language, WhatsApp consent, and an alert accurately; consent records a preference and is not permission to send unrelated messages."], fr: ["Créer une fiche client", "Saisissez les coordonnées du client et, si nécessaire, des notes. Renseignez précisément la langue, le consentement WhatsApp et le point d'attention; le consentement enregistre une préférence, pas une autorisation d'envoyer des messages sans rapport."] },
      { selector: ["#clientBody"], icon: "📇", en: ["Review a client profile", "Open a row to see the client's details and purchase history and, where permitted, update the record. Check the correct client before changing contact preferences or notes."], fr: ["Consulter une fiche client", "Ouvrez une ligne pour voir les coordonnées et l'historique d'achat et, si votre rôle le permet, modifier la fiche. Vérifiez qu'il s'agit du bon client avant de changer ses préférences ou ses notes."] },
    ],
    formation: [
      { selector: ["#overallCard"], icon: "📊", en: ["Your progress", "This card tracks completed lessons and passed quizzes."], fr: ["Votre progression", "Cette carte suit les leçons terminées et les quiz réussis."] },
      { selector: ["#daysWrap"], icon: "📚", en: ["Lessons and quizzes", "Open each lesson, then take its quiz to validate what you learned."], fr: ["Leçons et quiz", "Consultez chaque leçon, puis passez son quiz pour valider vos acquis."] },
      { selector: ["#adminSection"], icon: "👥", en: ["Team progress", "Administrators can review the team's training progress and notifications here."], fr: ["Progression de l'équipe", "Les administrateurs consultent ici la progression de l'équipe et ses notifications."] },
    ],
    messages: [
      { selector: ["#conversationList"], icon: "💬", en: ["Choose a group or a private chat", "Company group is the shared room: every company account can read it. Under Private messages, select a person's name to open a one-to-one chat. Administrators appear in the same list. Changing conversations never copies or exposes one chat's history in another."], fr: ["Choisir le groupe ou une conversation privée", "Groupe de l'entreprise est le salon commun : tous les comptes de l'entreprise peuvent le lire. Dans Messages privés, choisissez un nom pour ouvrir un échange individuel. Les administrateurs figurent dans la même liste. Changer de conversation n'affiche pas l'historique privé dans un autre échange."] },
      { selector: ["#conversationTitle"], icon: "🔒", en: ["Check who can read this conversation", "The header names the selected room or member. The group is visible to every company account; a private conversation is visible only to its two participants. Check this title before sending sensitive information."], fr: ["Vérifier qui peut lire la conversation", "L'en-tête indique le salon ou le membre sélectionné. Le groupe est visible par tous les comptes de l'entreprise; une conversation privée n'est visible que par ses deux participants. Vérifiez ce titre avant d'envoyer une information confidentielle."] },
      { selector: ["#messageList"], icon: "📨", en: ["Read and reply to messages", "Messages appear in time order; your own messages are aligned separately. Choose Reply under the specific message to quote it in your next message. The quote preserves context, but your reply is still posted in this same conversation."], fr: ["Lire et répondre aux messages", "Les messages s'affichent dans l'ordre chronologique; les vôtres sont alignés à part. Cliquez sur Répondre sous le message concerné pour le citer dans votre prochain envoi. La citation conserve le contexte, mais votre réponse reste dans cette conversation."] },
      { selector: ["#messageContent"], icon: "@" , en: ["Mention a platform member", "Type @ to open the member list, then choose a name. In the group, you can mention any platform member; in a private chat, only the other participant can be mentioned. A mention notifies that person when the message is sent."], fr: ["Mentionner un membre", "Tapez @ pour ouvrir la liste des membres, puis choisissez un nom. Dans le groupe, vous pouvez mentionner n'importe quel compte de la plateforme; en privé, seule la personne en face peut être mentionnée. La mention notifie cette personne à l'envoi."] },
      { selector: ["#messageContent"], icon: "✍️", en: ["Write your message", "Type plain text, up to 2,000 characters. Press Enter to send or Shift + Enter for a new line. A draft is not shared until you send it. This messenger is for conversation: it does not attach images, share links, or publish announcements or deadlines."], fr: ["Rédiger un message", "Saisissez du texte, jusqu'à 2 000 caractères. Appuyez sur Entrée pour envoyer ou Maj + Entrée pour aller à la ligne. Le brouillon reste privé tant qu'il n'est pas envoyé. Cette messagerie sert à discuter : elle ne joint pas d'image, ne partage pas de lien et ne publie ni annonce ni échéance."] },
      { selector: ["#replyPreview", "#messageList"], icon: "↩️", en: ["Confirm or cancel a reply", "After choosing Reply under a message, the quote appears above the composer. Make sure it refers to the right message; use the × button to cancel the reply before sending if needed."], fr: ["Vérifier ou annuler une réponse", "Après avoir choisi Répondre sous un message, la citation apparaît au-dessus de la zone de saisie. Vérifiez qu'elle correspond au bon message; utilisez × pour annuler la réponse avant l'envoi si nécessaire."] },
      { selector: ["#sendMessage"], icon: "📤", en: ["Send your message", "Select Send (or press Enter) to post the draft to the conversation shown in the header. Check the recipient and text first; a sent message is stored in the conversation history."], fr: ["Envoyer le message", "Cliquez sur Envoyer (ou appuyez sur Entrée) pour publier le brouillon dans la conversation indiquée en haut. Vérifiez le destinataire et le texte : le message envoyé est conservé dans l'historique."] },
    ],
    remuneration: [
      { selector: ["#month"], icon: "🗓️", en: ["Select the payroll month", "Choose the month to review. The totals, rows, and exports are for this month only; verify the period before you close it or download a statement."], fr: ["Sélectionner le mois de paie", "Choisissez le mois à consulter. Les totaux, lignes et exports concernent uniquement cette période; vérifiez-la avant de la clôturer ou de télécharger un relevé."] },
      { selector: ["#payBody"], icon: "🧮", en: ["Check each calculation", "Review each salesperson's validated sales, commission, bonus, and total. Compare the entries with the selected period; a preorder that has not been validated as a sale is not payable commission."], fr: ["Vérifier chaque calcul", "Consultez les ventes validées, commissions, bonus et totaux de chaque commercial. Contrôlez les lignes sur la période choisie; une précommande non validée en vente ne génère pas de commission à payer."] },
      { selector: ["#payExport"], icon: "📥", en: ["Download payroll details", "Choose the summary or an individual statement offered here. The selected month determines which figures are included; review personal details before sharing a downloaded file."], fr: ["Télécharger le détail de paie", "Choisissez ici le récapitulatif ou le relevé individuel proposé. Le mois sélectionné détermine les montants exportés; vérifiez les données personnelles avant de partager un fichier téléchargé."] },
      { selector: ["#closeBtn"], icon: "🔒", en: ["Close the payroll period", "Closing freezes the calculated period and advances its payroll status; it is not the same as marking every payment as sent. Verify the month and figures first, then confirm the action. Use the available status controls for later validation or payment."], fr: ["Clôturer la période de paie", "La clôture fige les calculs de la période et fait avancer son statut; elle ne signifie pas que tous les paiements ont été envoyés. Vérifiez d'abord le mois et les montants, puis confirmez. Utilisez ensuite les commandes de statut disponibles pour validation ou paiement."] },
    ],
    reports: [
      { selector: ["#rangeSel"], icon: "🗓️", en: ["Choose the reporting range", "Select the period to include. All summary figures and rows below use this date range; change it before comparing another period."], fr: ["Choisir la période du rapport", "Sélectionnez la période à inclure. Tous les indicateurs et toutes les lignes ci-dessous utilisent ces dates; changez la période avant de comparer un autre intervalle."] },
      { selector: ["#reportRows"], icon: "📊", en: ["Interpret the report rows", "Each row compares a salesperson's sales, units, revenue, and commission for the selected dates. These are reporting totals, not editable payroll records; use Payroll for period closing."], fr: ["Interpréter les lignes du rapport", "Chaque ligne compare les ventes, unités, chiffre d'affaires et commissions d'un commercial sur les dates choisies. Ce sont des totaux de rapport, pas des fiches de paie modifiables; utilisez Rémunération pour clôturer une période."] },
      { selector: ["#pdfBtn"], icon: "📄", en: ["Export the selected report", "Generate a PDF using the currently selected range. Confirm the period first, then open or save the downloaded file from your browser."], fr: ["Exporter le rapport sélectionné", "Générez un PDF pour la période actuellement choisie. Vérifiez les dates, puis ouvrez ou enregistrez le fichier téléchargé depuis votre navigateur."] },
    ],
    settings: [
      { selector: ["#fName"], icon: "👤", en: ["Edit your profile details", "Update the name or contact details shown for your account, then use the page's save action. These details identify you to teammates; they do not change your sign-in email unless a separate email control is provided."], fr: ["Modifier votre profil", "Mettez à jour le nom ou les coordonnées affichés pour votre compte, puis utilisez la commande d'enregistrement de la page. Ces informations vous identifient auprès de l'équipe; elles ne changent pas votre e-mail de connexion si aucun champ distinct n'est prévu."] },
      { selector: ["#themeSeg"], icon: "🌗", en: ["Set the display theme", "Choose the light or dark appearance. This is a personal display preference and does not change anyone else's view or the underlying data."], fr: ["Choisir le thème d'affichage", "Choisissez l'apparence claire ou sombre. C'est une préférence d'affichage personnelle qui ne modifie ni la vue des autres utilisateurs ni les données."] },
      { selector: ["#langSeg"], icon: "🌐", en: ["Set the interface language", "Switch between the supported languages. Labels and help text change immediately; your account data and message history are unchanged."], fr: ["Choisir la langue de l'interface", "Basculez entre les langues disponibles. Les libellés et aides changent immédiatement; vos données et l'historique des messages restent inchangés."] },
      { selector: ["#changePass"], icon: "🔐", en: ["Change your password or sign out", "Enter and confirm the new password in the fields above before updating it. Use a strong password you have not used elsewhere. Sign out ends the current session on this device."], fr: ["Changer de mot de passe ou se déconnecter", "Saisissez puis confirmez le nouveau mot de passe dans les champs au-dessus avant de l'enregistrer. Choisissez un mot de passe robuste et unique. La déconnexion ferme la session sur cet appareil."] },
    ],
    guide: [
      { selector: [".page-head"], icon: "📘", en: ["Find the right procedure", "Use this page to open the relevant instructions for sales, preorders, delivery, payment, validation, and exports. Follow the steps in order; a preorder becomes a sale only after delivery and full payment."], fr: ["Trouver la bonne procédure", "Utilisez cette page pour ouvrir les instructions adaptées aux ventes, précommandes, livraison, paiement, validation et exports. Suivez les étapes dans l'ordre; une précommande ne devient une vente qu'après livraison et paiement complet."] },
      { selector: [".sidebar-nav"], icon: "🧭", en: ["Navigate and reopen help", "Choose a section in the sidebar to switch pages. Each section shows its guide the first time you open it; use the question-mark help button in the header to replay that section's guide whenever you need it."], fr: ["Naviguer et retrouver l'aide", "Choisissez une rubrique dans le menu latéral pour changer de page. Son guide apparaît lors de la première visite; utilisez le bouton d'aide en forme de point d'interrogation dans l'en-tête pour le relancer à tout moment."] },
    ],
  };

  const PAGE_TOUR_LABELS = {
    en: { next: "Next", back: "Back", done: "Got it", skip: "Skip guide", step: "Step", title: "Quick guide", reopen: "Open this section's guide", language: "Guide language" },
    fr: { next: "Suivant", back: "Retour", done: "Compris", skip: "Passer le guide", step: "Étape", title: "Guide rapide", reopen: "Ouvrir le guide de cette rubrique", language: "Langue du guide" },
  };

  function pageTourLanguage() {
    return PAGE_TOUR_LABELS[KGI18N.lang] || PAGE_TOUR_LABELS.en;
  }

  function initPageTour() {
    const user = window.KGAuth && window.KGAuth._user;
    const userKey = (user && user.id) || "local";
    const seenKey = (key) => `kg-guide-seen:${encodeURIComponent(userKey)}:${key}`;
    const overlay = document.createElement("div");
    overlay.id = "kgPageTour";
    overlay.className = "kg-tour hidden";
    overlay.innerHTML = `
      <svg class="kg-tour-shade" aria-hidden="true">
        <path class="kg-tour-dim" fill-rule="evenodd"></path>
        <rect class="kg-tour-blocker" fill="transparent"></rect>
      </svg>
      <span class="kg-tour-cursor" aria-hidden="true">👆</span>
      <section class="kg-tour-card" role="dialog" aria-modal="true" aria-labelledby="kgTourTitle">
        <div class="kg-tour-card-head">
          <span class="kg-tour-icon" id="kgTourIcon"></span>
          <div class="kg-tour-head-meta">
            <div class="kg-tour-language" role="group">
              <button type="button" data-tour-lang="en" aria-label="English">EN</button>
              <button type="button" data-tour-lang="fr" aria-label="Français">FR</button>
            </div>
            <span class="kg-tour-step" id="kgTourStep"></span>
          </div>
        </div>
        <h2 id="kgTourTitle"></h2>
        <p id="kgTourBody"></p>
        <div class="kg-tour-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="kgTourSkip"></button>
          <div class="row gap-2"><button type="button" class="btn btn-ghost btn-sm" id="kgTourBack"></button>
          <button type="button" class="btn btn-primary btn-sm" id="kgTourNext"></button></div>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    const card = overlay.querySelector(".kg-tour-card");
    const path = overlay.querySelector(".kg-tour-dim");
    const blocker = overlay.querySelector(".kg-tour-blocker");
    const cursor = overlay.querySelector(".kg-tour-cursor");
    const targetClass = "kg-tour-highlight";
    let activeKey = null;
    let steps = [];
    let index = 0;
    let target = null;

    function findVisibleTarget(step) {
      for (const selector of step.selector) {
        const element = document.querySelector(selector);
        if (element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden") return element;
      }
      return null;
    }

    function positionTour() {
      if (!target || overlay.classList.contains("hidden")) return;
      const rect = target.getBoundingClientRect();
      const pad = 8;
      const x = Math.max(4, rect.left - pad);
      const y = Math.max(4, rect.top - pad);
      const width = Math.min(window.innerWidth - x - 4, rect.width + pad * 2);
      const height = Math.min(window.innerHeight - y - 4, rect.height + pad * 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      overlay.querySelector(".kg-tour-shade").setAttribute("viewBox", `0 0 ${w} ${h}`);
      path.setAttribute("d", `M0 0H${w}V${h}H0Z M${x} ${y}H${x + width}V${y + height}H${x}Z`);
      blocker.setAttribute("x", x);
      blocker.setAttribute("y", y);
      blocker.setAttribute("width", width);
      blocker.setAttribute("height", height);
      const cardWidth = Math.min(380, w - 32);
      card.style.width = `${cardWidth}px`;
      const left = Math.max(16, Math.min(rect.left, w - cardWidth - 16));
      const below = rect.bottom + 20;
      const top = below + card.offsetHeight <= h - 16
        ? below
        : Math.max(16, rect.top - card.offsetHeight - 20);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      cursor.style.left = `${Math.max(4, Math.min(rect.right - 20, w - 36))}px`;
      cursor.style.top = `${Math.max(4, Math.min(rect.bottom - 10, h - 40))}px`;
    }

    function closeTour() {
      if (target) target.classList.remove(targetClass);
      target = null;
      overlay.classList.add("hidden");
      document.body.classList.remove("kg-tour-open");
      if (activeKey) localStorage.setItem(seenKey(activeKey), "1");
      activeKey = null;
    }

    function renderStep() {
      while (index < steps.length && !findVisibleTarget(steps[index])) index++;
      if (index >= steps.length) {
        closeTour();
        return;
      }
      if (target) target.classList.remove(targetClass);
      target = findVisibleTarget(steps[index]);
      if (!target) return renderStep();
      target.classList.add(targetClass);
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      const lang = KGI18N.lang === "fr" ? "fr" : "en";
      const copy = steps[index][lang];
      const labels = pageTourLanguage();
      overlay.querySelector("#kgTourIcon").textContent = steps[index].icon;
      overlay.querySelector("#kgTourTitle").textContent = copy[0];
      overlay.querySelector("#kgTourBody").textContent = copy[1];
      overlay.querySelector("#kgTourStep").textContent = `${labels.step} ${index + 1} / ${steps.length}`;
      overlay.querySelector("#kgTourBack").textContent = labels.back;
      overlay.querySelector("#kgTourBack").disabled = index === 0;
      overlay.querySelector("#kgTourNext").textContent = index === steps.length - 1 ? labels.done : labels.next;
      overlay.querySelector("#kgTourSkip").textContent = labels.skip;
      overlay.querySelector(".kg-tour-language").setAttribute("aria-label", labels.language);
      overlay.querySelectorAll("[data-tour-lang]").forEach((button) => {
        const selected = button.dataset.tourLang === lang;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
      requestAnimationFrame(positionTour);
    }

    function open(key) {
      const pageKey = key || (location.hash === "#rewards" ? "rewards" : document.body.dataset.page);
      steps = (PAGE_TOURS[pageKey] || PAGE_TOURS[document.body.dataset.page] || PAGE_TOURS.guide)
        .filter((step) => findVisibleTarget(step));
      if (!steps.length) return false;
      activeKey = pageKey;
      index = 0;
      overlay.querySelector("#kgTourTitle").textContent = pageTourLanguage().title;
      overlay.classList.remove("hidden");
      document.body.classList.add("kg-tour-open");
      renderStep();
      overlay.querySelector("#kgTourNext").focus({ preventScroll: true });
      return true;
    }

    overlay.querySelector("#kgTourNext").addEventListener("click", () => {
      if (index >= steps.length - 1) closeTour();
      else { index++; renderStep(); }
    });
    overlay.querySelector("#kgTourBack").addEventListener("click", () => {
      if (index > 0) { index--; renderStep(); }
    });
    overlay.querySelector("#kgTourSkip").addEventListener("click", closeTour);
    overlay.querySelectorAll("[data-tour-lang]").forEach((button) => {
      button.addEventListener("click", () => KGI18N.set(button.dataset.tourLang));
    });
    document.addEventListener("keydown", (event) => {
      if (overlay.classList.contains("hidden")) return;
      if (event.key === "Escape") closeTour();
      if (event.key === "ArrowRight" && index < steps.length - 1) { index++; renderStep(); }
      if (event.key === "ArrowLeft" && index > 0) { index--; renderStep(); }
    });
    window.addEventListener("resize", positionTour);
    window.addEventListener("scroll", positionTour, true);
    window.addEventListener("kg:lang", () => {
      if (!overlay.classList.contains("hidden")) renderStep();
      overlay.querySelector("#kgTourSkip").textContent = pageTourLanguage().skip;
    });

    const helpButton = document.getElementById("helpBtn");
    if (helpButton) {
      helpButton.title = pageTourLanguage().reopen;
      helpButton.setAttribute("aria-label", pageTourLanguage().reopen);
      helpButton.addEventListener("click", () => open());
    }

    const pending = sessionStorage.getItem("kg-guide-pending");
    if (pending) {
      sessionStorage.removeItem("kg-guide-pending");
      try {
        const request = JSON.parse(pending);
        if (request.userId === userKey && !localStorage.getItem(seenKey(request.key))) {
          setTimeout(() => open(request.key), 350);
        }
      } catch (error) {
        console.warn("[KG] Could not read the first-visit guide request:", error);
      }
    }
    window.KGPageTour = { open };
  }

  function initTutorial() {
    if (document.getElementById("tutorialModal")) return;   // build once
    const role = ["salesperson", "relation_client"].includes(window.KG_ROLE) ? "salesperson" : "admin";
    const steps = TUTORIAL[role];
    let idx = 0;

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.id = "tutorialModal";
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;text-align:center">
        <div style="display:flex;justify-content:flex-end;padding:14px 16px 0">
          <div class="seg" id="tutLang">
            <button data-tl="en">EN</button>
            <button data-tl="fr">FR</button>
          </div>
        </div>
        <div class="modal-body" style="padding:18px 32px 30px">
          <div id="tutIcon" style="font-size:54px;line-height:1;margin-bottom:16px"></div>
          <h3 id="tutTitle" style="font-size:23px;margin-bottom:10px"></h3>
          <p id="tutBody" class="muted" style="font-size:14.5px;line-height:1.65"></p>
          <div id="tutDots" style="display:flex;gap:7px;justify-content:center;margin:24px 0 6px"></div>
          <div id="tutStep" class="muted" style="font-size:12px"></div>
        </div>
        <div class="modal-foot" style="justify-content:space-between">
          <button class="btn btn-ghost btn-sm" id="tutSkip"></button>
          <div class="row gap-2">
            <button class="btn btn-ghost" id="tutBack"></button>
            <button class="btn btn-primary" id="tutNext"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const g = (id) => overlay.querySelector(id);
    function render() {
      const lang = KGI18N.lang === "fr" ? "fr" : "en";
      const step = steps[idx], c = step[lang] || step.en;
      g("#tutIcon").textContent = step.icon;
      g("#tutTitle").textContent = c.t;
      g("#tutBody").textContent = c.b;
      g("#tutStep").textContent = `${tutL("step")} ${idx + 1} / ${steps.length}`;
      g("#tutDots").innerHTML = steps.map((_, i) =>
        `<span style="width:${i === idx ? "22px" : "8px"};height:8px;border-radius:8px;background:${i === idx ? "var(--brand)" : "var(--line)"};transition:all .3s"></span>`).join("");
      g("#tutBack").style.visibility = idx === 0 ? "hidden" : "visible";
      g("#tutBack").textContent = tutL("back");
      g("#tutNext").textContent = idx === steps.length - 1 ? tutL("done") : tutL("next");
      g("#tutSkip").textContent = tutL("skip");
      g("#tutSkip").style.visibility = idx === steps.length - 1 ? "hidden" : "visible";
      overlay.querySelectorAll("#tutLang button").forEach(b => b.classList.toggle("on", b.dataset.tl === KGI18N.lang));
    }
    function open() {
      localStorage.setItem("kg-tut-" + role, "1"); // seen → won't auto-open again
      idx = 0; render(); overlay.classList.add("open"); document.body.style.overflow = "hidden";
    }
    function close() { overlay.classList.remove("open"); document.body.style.overflow = ""; }

    g("#tutNext").addEventListener("click", () => { if (idx >= steps.length - 1) close(); else { idx++; render(); } });
    g("#tutBack").addEventListener("click", () => { if (idx > 0) { idx--; render(); } });
    g("#tutSkip").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    // In-tutorial language switch → updates the whole app + re-renders this tour
    overlay.querySelectorAll("#tutLang button").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.tl !== KGI18N.lang) KGI18N.set(b.dataset.tl); // fires kg:lang → render()
    }));
    window.addEventListener("kg:lang", () => { if (overlay.classList.contains("open")) render(); });

    window.KGTutorial = { open };
  }
  window.KG_initTutorial = initTutorial;

  /* -----------------------------------------------------------------------
     2. THEME (dark mode) — persisted
  ----------------------------------------------------------------------- */
  const THEME_KEY = "kg-theme";
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem(THEME_KEY, t);
    $$("[data-theme-ico]").forEach(el => el.innerHTML = icon(t === "dark" ? "sun" : "moon"));
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(cur);
    // Redraw charts with new palette
    setTimeout(() => window.dispatchEvent(new Event("kg:redraw")), 60);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  // Exposed so the Settings page can drive theming too
  window.KGTheme = {
    apply: (t) => { applyTheme(t); setTimeout(() => window.dispatchEvent(new Event("kg:redraw")), 60); },
    toggle: toggleTheme,
    current: () => document.documentElement.getAttribute("data-theme") || "light",
  };

  /* -----------------------------------------------------------------------
     3. NAVIGATION MODEL
  ----------------------------------------------------------------------- */
  // Each item declares which roles may see it + its sidebar group.
  // 'dashboard' and 'notifications' hrefs are resolved per-role at render time.
  const NAV = [
    { key: "dashboard",    label: "Dashboard",    icon: "grid",   group: "Main",     roles: ["admin","salesperson","relation_client"] },
    { key: "sales",        label: "Sales",        icon: "bag",    group: "Main",     roles: ["admin","salesperson","relation_client"], href: "sales.html" },
    { key: "history",      label: "Sales follow-up", icon: "clipboard", group: "Main", roles: ["admin","salesperson","relation_client"], href: "orders.html" },
    { key: "salespersons", label: "Salespersons", icon: "users",  group: "Main",     roles: ["admin"],               href: "salespersons.html" },
    { key: "ranking",      label: "Rankings",     icon: "trophy", group: "Main",     roles: ["admin","salesperson","relation_client"], href: "ranking.html" },
    { key: "challenges",   label: "Challenges",   icon: "flag",   group: "Main",     roles: ["admin","salesperson","relation_client"], href: "challenges.html" },
    { key: "clients",      label: "Clients",      icon: "heart",  group: "Main",     roles: ["admin","salesperson","relation_client"], href: "clients.html" },
    { key: "formation",    label: "Training",     icon: "book",   group: "Main",     roles: ["admin","salesperson","relation_client"], href: "formation.html" },
    { key: "messages",     label: "Messages",     icon: "mail",   group: "Main",     roles: ["admin","salesperson","relation_client"], href: "messages.html" },
    { key: "remuneration", label: "Payroll",      icon: "dollar", group: "Insights", roles: ["admin"],               href: "remuneration.html" },
    { key: "rewards",      label: "Rewards",      icon: "gift",   group: "Insights", roles: ["admin","salesperson","relation_client"], href: "challenges.html#rewards" },
    { key: "reports",      label: "Reports",      icon: "file",   group: "Insights", roles: ["admin"],               href: "reports.html" },
    { key: "guide",        label: "Guide",        icon: "help",   group: "System",   roles: ["admin","salesperson","relation_client"], href: "guide-commandes.html" },
    { key: "settings",     label: "Settings",     icon: "gear",   group: "System",   roles: ["admin","salesperson","relation_client"], href: "settings.html" },
  ];

  /* -----------------------------------------------------------------------
     4. LAYOUT INJECTION (reusable shell: sidebar + topbar)
     A page opts in with <body data-app data-page="dashboard" data-title="...">
  ----------------------------------------------------------------------- */
  function buildLayout() {
    const body = document.body;
    if (!body.hasAttribute("data-app")) return;
    const page = body.dataset.page || "dashboard";
    const title = page === "messages" ? t("head.messages.t") : (body.dataset.title || "Dashboard");
    const me = KG.me || { name: "Admin", initials: "AD" };
    const appRole = window.KG_ROLE || "admin";                 // 'admin' | 'salesperson'
    const role = body.dataset.role || (appRole === "salesperson" ? "Salesperson" : "Administrator");
    const home = ["salesperson", "relation_client"].includes(appRole) ? "salesperson.html" : "dashboard.html";

    // Resolve role-specific hrefs, then keep only items this role may see
    const visibleNav = NAV
      .filter(n => (n.roles || ["admin"]).includes(appRole))
      .map(n => {
        let href = n.href;
        if (n.key === "dashboard") href = home;
        if (n.key === "notifications") href = home + "#notifs";
        return Object.assign({}, n, { href });
      });
    const groupOrder = ["Main", "Insights", "System"];
    const groupLabels = { Main: "Main", Insights: "Insights", System: "System" };
    const navSections = groupOrder.map(g => {
      const items = visibleNav.filter(n => n.group === g);
      if (!items.length) return "";
      return `<div class="nav-label" data-i18n="group.${g.toLowerCase()}">${t("group." + g.toLowerCase())}</div>` + items.map(navHtml(page)).join("");
    }).join("");

    // Keep the original page nodes. Page scripts (for example messages.js)
    // bind listeners before this shell is built; serializing innerHTML here
    // recreated those nodes and silently detached every listener.
    const pageNodes = Array.from(body.childNodes);
    body.replaceChildren();

    const shell = document.createElement("div");
    shell.className = "app-shell";
    shell.id = "shell";

    // ---- Sidebar (grouped nav sections built via navHtml) ----
    shell.innerHTML = `
      <div class="nav-scrim" id="navScrim"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          ${LOGO}
          <div class="brand-txt">
            <strong>KGROUP</strong>
            <span>Parfumery</span>
          </div>
        </div>
        <nav class="sidebar-nav">
          ${navSections}
          <a href="login.html" class="nav-item" data-nav="logout">${icon("logout")}<span data-i18n="nav.logout">${t("nav.logout")}</span></a>
        </nav>
        <div class="sidebar-foot">
          <div class="sidebar-user">
            ${avatar(me, 38)}
            <div>
              <div class="u-name">${me.name}</div>
              <div class="u-role">${role}</div>
            </div>
          </div>
        </div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="icon-btn hamburger" id="hamburger" aria-label="Menu">${icon("menu")}</button>
          <button class="icon-btn collapse-btn" id="collapseBtn" title="${t("topbar.collapse")}" aria-label="${t("topbar.collapse")}">${icon("panel")}</button>
          <div class="topbar-title">
            <h1>${title}</h1>
            <div class="crumb">KGROUP • ${title}</div>
          </div>
          <div class="grow"></div>
          <div class="search-box">
            ${icon("search")}
            <input type="text" id="globalSearch" placeholder="Search anything…" data-i18n-ph="topbar.search">
          </div>
          <div class="dropdown" id="langDropdown">
            <button class="icon-btn" id="langBtn" title="Language"><b id="langCode" style="font-size:12px;letter-spacing:.04em">${KGI18N.lang.toUpperCase()}</b></button>
            <div class="dropdown-panel" style="width:180px">
              <div class="dropdown-list" id="langList"></div>
            </div>
          </div>
          <button class="icon-btn" id="helpBtn" title="${tutL("help")}">${icon("help")}</button>
          <button class="icon-btn" id="themeBtn" title="Toggle theme"><span data-theme-ico>${icon("moon")}</span></button>
          <div class="dropdown" id="notifDropdown">
            <button class="icon-btn" id="notifBtn" title="${t("notif.title")}" aria-label="${t("notif.title")}" aria-haspopup="true" aria-expanded="false">${icon("bell")}<span class="notif-count" id="notifCount" hidden></span></button>
            <div class="dropdown-panel" role="dialog" aria-label="${t("notif.title")}">
              <div class="dropdown-head">
                <strong data-i18n="notif.title">${t("notif.title")}</strong>
                <a href="#" class="link" id="markAll" data-i18n="notif.markAll">${t("notif.markAll")}</a>
              </div>
              <div class="dropdown-list" id="notifList"></div>
            </div>
          </div>
          ${avatar(me, 42)}
        </header>
        <div class="content" id="content"></div>
      </div>`;

    body.appendChild(shell);
    const content = $("#content");
    pageNodes.forEach((node) => content.appendChild(node));

    // Fill notifications dropdown + unread badge
    renderNotifs();
    renderBell();

    // Wire interactions
    wireShell();
    $$(".sidebar-nav a[data-nav]").forEach((link) => {
      link.addEventListener("click", async (event) => {
        const key = link.dataset.nav;
        if (!key || key === "logout" || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        try {
          const user = await window.KGAuth.user();
          if (user) {
            sessionStorage.setItem("kg-guide-pending", JSON.stringify({ userId: user.id || "local", key }));
          }
        } catch (error) {
          console.warn("[KG] Could not schedule the first-visit guide:", error);
        }
        window.location.assign(link.href);
      });
    });

    // Translate everything now that the shell + page content are in the DOM
    KGI18N.apply(document);

    // Preserve the legacy tutorial entry point for existing callers.
    initTutorial();
    body.classList.add("app-shell-ready");
  }

  /* ----- "Seen" tracking so nav badges clear after you visit a section ----- */
  const seenKey = (k) => "kg-seen-" + k;
  const getSeen = (k) => parseInt(localStorage.getItem(seenKey(k)) || "0", 10);
  const setSeen = (k, n) => localStorage.setItem(seenKey(k), String(n));

  /* Human "time ago" from a real timestamp (ms). */
  function relTime(ms) {
    if (!ms) return "";
    const diff = Date.now() - ms;
    if (diff < 45000) return "just now";
    const m = Math.floor(diff / 60000);
    if (m < 60) return m + (m === 1 ? " min ago" : " min ago");
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.floor(h / 24);
    if (d === 1) return "Yesterday";
    if (d < 7) return d + " days ago";
    return new Date(ms).toLocaleDateString();
  }
  window.KGrelTime = relTime;

  /* Build the notification feed from REAL activity: the team feed (client
     birthdays, training successes), sales and challenges, newest first.
     The pure logic (merge, sort, unread) lives in notifications.js; this only
     gathers the sources and the user's "seen up to" timestamp. */
  const NF = window.KGNotifFeed;
  const notifSeenKey = () => NF.storageKey(window.KG && window.KG.me && window.KG.me.id);
  function getNotifSeenAt() {
    try { return Number(localStorage.getItem(notifSeenKey())) || 0; } catch (_) { return 0; }
  }
  function setNotifSeenAt(ms) {
    try { localStorage.setItem(notifSeenKey(), String(ms)); } catch (_) { /* storage unavailable */ }
  }
  function buildNotifications() {
    const K = window.KG; if (!K) return [];
    if (!NF) { K.notifications = []; return []; }
    const feed = NF.buildFeed(
      { team: K.teamNotifications, sales: K.feedSales || K.recentSales, challenges: K.feedChallenges || K.challenges },
      { seenAt: getNotifSeenAt(), labels: { newSale: t("notif.newSale"), newChallenge: t("notif.newChallenge"), by: t("notif.by") } }
    );
    // `type` and `time` are what the dashboard's own notification block reads.
    feed.forEach(n => { n.type = n.tone; n.time = NF.relativeTime(n.ts, Date.now(), KGI18N.lang) || t("notif.active"); });
    K.notifications = feed;
    return feed;
  }

  /* How many unseen items to badge on a given nav item (0 = no badge). */
  function badgeFor(key) {
    const K = window.KG || {};
    if (key === "challenges")    return Math.max(0, (K.challenges || []).length - getSeen("chal"));
    if (key === "notifications") return (K.notifications || []).filter(n => n.unread).length;
    return 0;
  }

  const navHtml = (page) => (n) => {
    const b = badgeFor(n.key);
    return `
    <a href="${n.href}" class="nav-item ${n.key === page ? "active" : ""}" data-nav="${n.key}">
      ${icon(n.icon)}<span data-i18n="nav.${n.key}">${t("nav." + n.key)}</span>
      ${b ? `<span class="nav-badge">${b}</span>` : ""}
    </a>`;
  };

  function avatar(p, size) {
    const s = size || 40;
    const hue = p.hue != null ? p.hue : 150;
    return `<span class="avatar-fallback" style="width:${s}px;height:${s}px;font-size:${Math.round(s*0.36)}px;background:linear-gradient(135deg,hsl(${hue},55%,45%),hsl(${(hue+40)%360},60%,32%))">${p.initials || "?"}</span>`;
  }
  window.kgAvatar = avatar;

  function renderNotifs() {
    const list = $("#notifList");
    if (!list) return;
    const feed = KG.notifications || [];
    if (!feed.length || !NF) {
      list.innerHTML = `<div class="notif-empty"><div class="notif-empty-ico">🔔</div><div>${t("notif.empty")}</div></div>`;
      return;
    }
    const esc = NF.escapeHtml;
    const tone = { success: "ico-green", info: "ico-blue", gold: "ico-gold" };
    list.innerHTML = feed.map(n => {
      // A notification opens the page where it can be acted on.
      const tag = n.href ? "a" : "div";
      const href = n.href ? ` href="${esc(n.href)}"` : "";
      return `<${tag} class="notif ${n.unread ? "unread" : ""}"${href} data-notif-id="${esc(n.id)}">
        <div class="notif-ico ${tone[n.tone] || tone.info}" style="color:#fff">${icon(n.icon)}</div>
        <div class="grow notif-text">
          <div class="notif-title">${esc(n.title)}</div>
          ${n.body ? `<div class="notif-body">${esc(n.body)}</div>` : ""}
          <div class="f-time">${esc(n.time)}</div>
        </div>
        ${n.unread ? '<span class="dot on" style="align-self:center"></span>' : ""}
      </${tag}>`;
    }).join("");
  }

  /* Unread counter on the bell (hidden at zero, "9+" beyond nine). */
  function renderBell() {
    const badge = $("#notifCount");
    if (!badge || !NF) return;
    const n = NF.unreadCount(KG.notifications);
    badge.textContent = NF.badgeLabel(n);
    badge.hidden = n === 0;
    $("#notifBtn")?.setAttribute("aria-label", n ? `${t("notif.title")} (${n})` : t("notif.title"));
  }

  function wireShell() {
    const shell = $("#shell");
    // Collapse (desktop) / open (mobile)
    $("#collapseBtn")?.addEventListener("click", () => {
      if (window.innerWidth <= 860) shell.classList.toggle("nav-open");
      else shell.classList.toggle("collapsed");
    });
    $("#hamburger")?.addEventListener("click", () => shell.classList.toggle("nav-open"));
    $("#navScrim")?.addEventListener("click", () => shell.classList.remove("nav-open"));
    $("#themeBtn")?.addEventListener("click", toggleTheme);

    // Language dropdown
    const langDd = $("#langDropdown");
    const langList = $("#langList");
    function renderLangs() {
      if (!langList) return;
      langList.innerHTML = KGI18N.langs.map(l => `
        <button class="nav-item lang-option${l.code === KGI18N.lang ? " selected" : ""}" data-lang="${l.code}" style="width:100%;text-align:left">
          <b style="width:26px">${l.code.toUpperCase()}</b><span>${l.label}</span>
          ${l.code === KGI18N.lang ? '<span class="grow"></span>' + icon("check") : ""}
        </button>`).join("");
      langList.querySelectorAll("[data-lang]").forEach(b => b.addEventListener("click", () => {
        KGI18N.set(b.dataset.lang);
        $("#langCode").textContent = b.dataset.lang.toUpperCase();
        langDd.classList.remove("open");
        renderLangs();
        toast("success", KGI18N.lang === "fr" ? "Langue : Français" : "Language: English", "");
      }));
    }
    renderLangs();
    $("#langBtn")?.addEventListener("click", (e) => { e.stopPropagation(); langDd.classList.toggle("open"); });
    document.addEventListener("click", (e) => { if (langDd && !langDd.contains(e.target)) langDd.classList.remove("open"); });

    // Real logout → end the API session, then go to login
    $('[data-nav="logout"]')?.addEventListener("click", async (e) => {
      e.preventDefault();
      if (window.KGAuth) { try { await window.KGAuth.signOut(); } catch (_) {} }
      window.location.href = "login.html";
    });

    // Notifications bell — opening the panel marks what it shows as seen;
    // the highlight stays until the next opening so the user sees what's new.
    const dd = $("#notifDropdown");
    const notifBtn = $("#notifBtn");
    const notifOpen = () => Boolean(dd && dd.classList.contains("open"));
    function acknowledgeNotifs() {
      if (!NF) return;
      setNotifSeenAt(NF.markSeen(KG.notifications, getNotifSeenAt()));
      const persistentIds = (KG.teamNotifications || [])
        .filter(n => n && n.id != null && !n.read_at)
        .map(n => String(n.id));
      if (persistentIds.length && window.KGTraining) {
        window.KGTraining.markNotificationsRead(persistentIds)
          .then(() => {
            const now = new Date().toISOString();
            (KG.teamNotifications || []).forEach(n => {
              if (persistentIds.includes(String(n.id))) n.read_at = now;
            });
          })
          .catch(err => console.warn("[KG] Could not persist notification read state:", err));
      }
      (KG.notifications || []).forEach(n => { n.unread = false; });
      renderBell();
    }
    function openNotifs() {
      if (!dd) return;
      renderNotifs();
      dd.classList.add("open");
      notifBtn?.setAttribute("aria-expanded", "true");
      acknowledgeNotifs();
    }
    function closeNotifs() {
      if (!notifOpen()) return;
      dd.classList.remove("open");
      notifBtn?.setAttribute("aria-expanded", "false");
    }
    let refreshing = null;
    function refreshNotifications() {
      if (!window.KG_API_CONFIGURED || !window.KGTraining || !window.KGDB) return Promise.resolve();
      if (refreshing) return refreshing;             // one refresh at a time
      refreshing = Promise.all([
        window.KGTraining.notifications(20),
        window.KGDB.listSales(20),
        window.KGDB.listChallenges(),
      ]).then(([team, sales, challenges]) => {
        const K = window.KG;
        if (team) K.teamNotifications = team;
        if (sales) K.feedSales = sales.map(x => ({ id: x.id, product: x.product, perfume: x.perfume_name, qty: x.qty, rep: x.rep_name || "", at: x.created_at }));
        if (challenges) K.feedChallenges = challenges.map(c => ({ id: c.id, title: c.title, reward: c.reward, createdAt: c.created_at }));
        buildNotifications();
        // Something new arrived while the panel is open: show it right away.
        if (notifOpen() && NF && NF.unreadCount(KG.notifications)) { renderNotifs(); acknowledgeNotifs(); }
        renderBell();
      }).catch(err => console.warn("Notifications refresh failed:", err))
        .finally(() => { refreshing = null; });
      return refreshing;
    }
    notifBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (notifOpen()) { closeNotifs(); return; }
      openNotifs();
      refreshNotifications();
    });
    document.addEventListener("click", (e) => { if (dd && !dd.contains(e.target)) closeNotifs(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeNotifs(); });
    $("#markAll")?.addEventListener("click", (e) => {
      e.preventDefault();
      acknowledgeNotifs();
      $$("#notifList .notif.unread").forEach(el => el.classList.remove("unread"));
      $$("#notifList .dot.on").forEach(el => el.remove());
      toast("success", t("notif.allRead"), t("notif.allRead.msg"));
    });
    window.addEventListener("kg:lang", () => { buildNotifications(); renderNotifs(); renderBell(); });
    if (window.KG_API_CONFIGURED) {
      // Poll while the tab is visible, and catch up as soon as it comes back.
      setInterval(() => { if (!document.hidden) refreshNotifications(); }, 60_000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshNotifications(); });
    }
    $('[data-nav="challenges"]')?.addEventListener("click", () =>
      setSeen("chal", (window.KG.challenges || []).length));

    // Global search → filter any [data-searchable] table on the page
    $("#globalSearch")?.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      $$("[data-searchable] tbody tr").forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });

    // Restore collapsed pref
    if (localStorage.getItem("kg-collapsed") === "1" && window.innerWidth > 860) shell.classList.add("collapsed");
    $("#collapseBtn")?.addEventListener("click", () => {
      if (window.innerWidth > 860) localStorage.setItem("kg-collapsed", shell.classList.contains("collapsed") ? "1" : "0");
    });
  }

  /* -----------------------------------------------------------------------
     5. ANIMATED COUNTERS
  ----------------------------------------------------------------------- */
  function animateCounters(root = document) {
    $$("[data-count]", root).forEach(el => {
      const target = parseFloat(el.dataset.count);
      const dur = 1300, prefix = el.dataset.prefix || "", suffix = el.dataset.suffix || "";
      const isMoney = el.dataset.money === "1";
      let start = null;
      function step(ts) {
        if (!start) start = ts;
        const p = Math.min((ts - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = target * eased;
        el.textContent = prefix + (isMoney ? KG.fmt.moneyShort(val) : KG.fmt.num(val)) + suffix;
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = prefix + (isMoney ? KG.fmt.moneyShort(target) : KG.fmt.num(target)) + suffix;
      }
      requestAnimationFrame(step);
    });
  }
  window.animateCounters = animateCounters;

  /* -----------------------------------------------------------------------
     6. PROGRESS BARS / RINGS animate on reveal
  ----------------------------------------------------------------------- */
  function animateBars(root = document) {
    $$("[data-bar]", root).forEach(el => {
      const pct = el.dataset.bar;
      requestAnimationFrame(() => setTimeout(() => { el.style.width = pct + "%"; }, 120));
    });
  }
  window.animateBars = animateBars;

  function drawRing(el) {
    const pct = +el.dataset.ring;
    const size = 128, sw = 12, r = (size - sw) / 2, c = 2 * Math.PI * r;
    const track = getVar("--line-2"), col = getVar("--brand");
    el.innerHTML = `
      <svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}"
          stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" class="ring-prog"/>
      </svg>
      <div class="ring-val"><b>${pct}%</b><span>${el.dataset.ringLabel||"of target"}</span></div>`;
    const prog = el.querySelector(".ring-prog");
    requestAnimationFrame(() => setTimeout(() => {
      prog.style.transition = "stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1)";
      prog.style.strokeDashoffset = c * (1 - pct / 100);
    }, 150));
  }

  /* -----------------------------------------------------------------------
     7. CANVAS CHARTS  (line, bar, sparkline) — hi-DPI, animated
  ----------------------------------------------------------------------- */
  const getVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function setupCanvas(canvas, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  function lineChart(canvas, opts) {
    const h = opts.height || 280;
    const { ctx, w } = setupCanvas(canvas, h);
    const pad = { l: 42, r: 16, t: 18, b: 30 };
    const data = opts.data, labels = opts.labels;
    const series = opts.series; // [{values, color, fill}]
    const allVals = series.flatMap(s => s.values);
    const max = (Math.max(...allVals) * 1.12) || 1, min = 0; // || 1 guards all-zero data
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const x = (i, n) => pad.l + (cw * i) / (n - 1);
    const y = (v) => pad.t + ch - ((v - min) / (max - min)) * ch;
    const grid = getVar("--line"), muted = getVar("--muted");

    let t = 0;
    function frame() {
      t = Math.min(t + 0.045, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      ctx.clearRect(0, 0, w, h);

      // grid + y labels
      ctx.font = "11px Inter, sans-serif"; ctx.fillStyle = muted; ctx.textAlign = "right";
      for (let g = 0; g <= 4; g++) {
        const gy = pad.t + (ch * g) / 4;
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
        const val = max - ((max - min) * g) / 4;
        ctx.fillText(KG.fmt.moneyShort(val), pad.l - 8, gy + 4);
      }
      // x labels
      ctx.textAlign = "center";
      labels.forEach((lb, i) => { if (labels.length > 8 && i % 2) return; ctx.fillText(lb, x(i, labels.length), h - 8); });

      // series
      series.forEach(s => {
        const n = s.values.length;
        ctx.beginPath();
        s.values.forEach((v, i) => {
          const px = x(i, n), py = y(v * ease);
          i === 0 ? ctx.moveTo(px, py) : smoothTo(ctx, s.values, i, x, y, ease, n);
        });
        ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.lineJoin = "round";
        ctx.stroke();
        if (s.fill) {
          ctx.lineTo(x(n - 1, n), pad.t + ch); ctx.lineTo(x(0, n), pad.t + ch); ctx.closePath();
          const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
          grad.addColorStop(0, s.fill); grad.addColorStop(1, "transparent");
          ctx.fillStyle = grad; ctx.fill();
        }
        // end dot
        if (t >= 1) {
          const lx = x(n - 1, n), ly = y(s.values[n - 1]);
          ctx.beginPath(); ctx.arc(lx, ly, 4.5, 0, 7); ctx.fillStyle = s.color; ctx.fill();
          ctx.beginPath(); ctx.arc(lx, ly, 8, 0, 7); ctx.strokeStyle = s.color; ctx.globalAlpha = .25; ctx.lineWidth = 6; ctx.stroke(); ctx.globalAlpha = 1;
        }
      });
      if (t < 1) requestAnimationFrame(frame);
    }
    frame();
  }
  function smoothTo(ctx, vals, i, x, y, ease, n) {
    // simple curve using midpoints for smoothness
    const x0 = x(i - 1, n), y0 = y(vals[i - 1] * ease);
    const x1 = x(i, n), y1 = y(vals[i] * ease);
    const mx = (x0 + x1) / 2;
    ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }

  function barChart(canvas, opts) {
    const h = opts.height || 260;
    const { ctx, w } = setupCanvas(canvas, h);
    const pad = { l: 38, r: 12, t: 16, b: 30 };
    const vals = opts.values, labels = opts.labels;
    const max = (Math.max(...vals) * 1.15) || 1; // guard all-zero data
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const bw = (cw / vals.length) * 0.55;
    const gap = (cw / vals.length);
    const grid = getVar("--line"), muted = getVar("--muted"), brand = getVar("--brand"), brand4 = getVar("--brand-400");

    // Empty state — a flat baseline + message beats a garbled axis when there's no data.
    if (Math.max(0, ...vals) <= 0) {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, pad.t + ch); ctx.lineTo(w - pad.r, pad.t + ch); ctx.stroke();
      ctx.fillStyle = muted; ctx.textAlign = "center";
      ctx.font = "12px Inter, sans-serif"; ctx.fillText("No sales yet", w / 2, pad.t + ch / 2);
      ctx.font = "11px Inter, sans-serif";
      vals.forEach((_, i) => { const bx = pad.l + gap * i + (gap - bw) / 2; ctx.fillText(labels[i], bx + bw / 2, h - 8); });
      return;
    }

    let t = 0;
    function frame() {
      t = Math.min(t + 0.05, 1); const ease = 1 - Math.pow(1 - t, 3);
      ctx.clearRect(0, 0, w, h);
      ctx.font = "11px Inter, sans-serif"; ctx.fillStyle = muted; ctx.textAlign = "right";
      for (let g = 0; g <= 4; g++) {
        const gy = pad.t + (ch * g) / 4;
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(w - pad.r, gy); ctx.stroke();
        ctx.fillText(KG.fmt.moneyShort(max - (max * g) / 4), pad.l - 8, gy + 4);
      }
      ctx.textAlign = "center";
      vals.forEach((v, i) => {
        const bh = ((v / max) * ch) * ease;
        const bx = pad.l + gap * i + (gap - bw) / 2;
        const by = pad.t + ch - bh;
        const grad = ctx.createLinearGradient(0, by, 0, pad.t + ch);
        grad.addColorStop(0, brand4); grad.addColorStop(1, brand);
        ctx.fillStyle = grad;
        roundRect(ctx, bx, by, bw, bh, 6); ctx.fill();
        ctx.fillStyle = muted;
        ctx.fillText(labels[i], bx + bw / 2, h - 8);
      });
      if (t < 1) requestAnimationFrame(frame);
    }
    frame();
  }

  function sparkline(canvas, values, color) {
    const h = 46; const { ctx, w } = setupCanvas(canvas, h);
    const max = Math.max(...values), min = Math.min(...values);
    const x = (i) => (w * i) / (values.length - 1);
    const y = (v) => h - 6 - ((v - min) / (max - min || 1)) * (h - 12);
    ctx.beginPath();
    values.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.stroke();
    ctx.lineTo(x(values.length - 1), h); ctx.lineTo(0, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, color + "55"); grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad; ctx.fill();
  }

  function donutChart(canvas, segments) {
    const h = 200; const { ctx, w } = setupCanvas(canvas, h);
    const cx = w / 2, cy = h / 2, r = 76, sw = 24;
    const total = segments.reduce((s, x) => s + x.value, 0);
    if (!total) { // empty state — draw a neutral ring with "No data"
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = getVar("--line"); ctx.lineWidth = sw; ctx.stroke();
      ctx.fillStyle = getVar("--muted"); ctx.textAlign = "center"; ctx.font = "12px Inter";
      ctx.fillText("No data yet", cx, cy + 4);
      return;
    }
    let t = 0;
    function frame() {
      t = Math.min(t + 0.04, 1); const ease = 1 - Math.pow(1 - t, 3);
      ctx.clearRect(0, 0, w, h);
      let ang = -Math.PI / 2;
      segments.forEach(seg => {
        const slice = (seg.value / total) * Math.PI * 2 * ease;
        ctx.beginPath(); ctx.arc(cx, cy, r, ang, ang + slice);
        ctx.strokeStyle = seg.color; ctx.lineWidth = sw; ctx.lineCap = "round"; ctx.stroke();
        ang += slice;
      });
      ctx.fillStyle = getVar("--ink"); ctx.textAlign = "center"; ctx.font = "700 24px Sora, sans-serif";
      ctx.fillText(KG.fmt.moneyShort(total), cx, cy);
      ctx.fillStyle = getVar("--muted"); ctx.font = "11px Inter"; ctx.fillText("Total units", cx, cy + 18);
      if (t < 1) requestAnimationFrame(frame);
    }
    frame();
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h < r) r = h;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, 0);
    ctx.arcTo(x, y + h, x, y, 0);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.KGCharts = { lineChart, barChart, sparkline, donutChart, drawRing };

  /* -----------------------------------------------------------------------
     8. MODALS
  ----------------------------------------------------------------------- */
  function openModal(id) { const m = $(id); if (m) { m.classList.add("open"); document.body.style.overflow = "hidden"; } }
  function closeModal(m) { m.classList.remove("open"); document.body.style.overflow = ""; }
  function wireModals() {
    $$("[data-modal-open]").forEach(b => b.addEventListener("click", () => openModal(b.dataset.modalOpen)));
    $$(".modal-overlay").forEach(ov => {
      ov.addEventListener("click", e => { if (e.target === ov) closeModal(ov); });
      $$("[data-modal-close]", ov).forEach(b => b.addEventListener("click", () => closeModal(ov)));
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") $$(".modal-overlay.open").forEach(closeModal); });
  }
  window.kgModal = { open: openModal, close: closeModal };

  /* -----------------------------------------------------------------------
     9. TOASTS
  ----------------------------------------------------------------------- */
  function toast(type, title, msg) {
    let wrap = $(".toast-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="t-ico">${icon(type === "error" ? "x" : type === "info" ? "bell" : "check")}</div>
      <div class="grow"><div class="t-title">${title}</div><div class="t-msg">${msg||""}</div></div>`;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 3800);
  }
  window.toast = toast;

  /* -----------------------------------------------------------------------
     10. TABLE: sort + paginate + filter (generic)
  ----------------------------------------------------------------------- */
  function initTable(config) {
    const { tbody, rows, render, perPage = 8, mount } = config;
    let data = rows.slice(), page = 1, sortKey = null, sortDir = 1, filter = () => true;

    function draw() {
      const filtered = data.filter(filter);
      const pages = Math.max(1, Math.ceil(filtered.length / perPage));
      page = Math.min(page, pages);
      const slice = filtered.slice((page - 1) * perPage, page * perPage);
      tbody.innerHTML = slice.map(render).join("") || `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--muted)">No results found</td></tr>`;
      animateBars(tbody);
      drawPager(filtered.length, pages);
      config.onDraw && config.onDraw();
    }
    function drawPager(total, pages) {
      const pager = $(config.pager);
      if (!pager) return;
      let btns = "";
      for (let i = 1; i <= pages; i++) btns += `<button class="page-btn ${i === page ? "on" : ""}" data-page="${i}">${i}</button>`;
      pager.innerHTML = `
        <span class="muted" style="font-size:13px">Showing ${Math.min((page-1)*perPage+1,total)}–${Math.min(page*perPage,total)} of ${total}</span>
        <div class="pages">
          <button class="page-btn" data-page="prev" ${page===1?"disabled":""}>‹</button>
          ${btns}
          <button class="page-btn" data-page="next" ${page===pages?"disabled":""}>›</button>
        </div>`;
      $$(".page-btn", pager).forEach(b => b.addEventListener("click", () => {
        const v = b.dataset.page;
        if (v === "prev") page--; else if (v === "next") page++; else page = +v;
        draw();
      }));
    }
    // sorting
    if (config.sortable) {
      $$("th.sortable", mount).forEach(th => th.addEventListener("click", () => {
        const key = th.dataset.key;
        sortDir = sortKey === key ? -sortDir : 1;
        sortKey = key;
        $$("th.sortable", mount).forEach(t => t.classList.remove("asc", "desc"));
        th.classList.add(sortDir === 1 ? "asc" : "desc");
        data.sort((a, b) => {
          const av = a[key], bv = b[key];
          return (typeof av === "number" ? av - bv : String(av).localeCompare(String(bv))) * sortDir;
        });
        page = 1; draw();
      }));
    }
    // expose filter setter
    config.setFilter = (fn) => { filter = fn; page = 1; draw(); };
    config.setSearch = (q) => { const s = q.toLowerCase(); filter = (r) => JSON.stringify(r).toLowerCase().includes(s); page = 1; draw(); };
    draw();
    return config;
  }
  window.KGTable = initTable;

  /* -----------------------------------------------------------------------
     10b. PERIODES — choix de période partagé (Suivi des ventes, Rapports)
     Dates locales « AAAA-MM-JJ », bornes incluses, comme l'API
     /api/sales/history.
  ----------------------------------------------------------------------- */
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const frDay = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
  const PERIOD_LABELS = {
    month: "Ce mois-ci", last_month: "Mois dernier", quarter: "Ce trimestre", "3m": "3 derniers mois",
    "12m": "12 derniers mois", year: "Cette année", all: "Depuis le début", custom: "Personnalisée",
  };
  const KGPeriod = {
    labels: PERIOD_LABELS,
    /** { from, to, label } pour un préréglage ; from/to nuls = sans limite. */
    range(key, custom) {
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      const today = isoDay(now);
      let from = null, to = today;
      if (key === "month") from = isoDay(new Date(y, m, 1));
      else if (key === "last_month") { from = isoDay(new Date(y, m - 1, 1)); to = isoDay(new Date(y, m, 0)); }
      else if (key === "quarter") from = isoDay(new Date(y, m - (m % 3), 1));
      else if (key === "3m") from = isoDay(new Date(y, m - 2, 1));
      else if (key === "12m") from = isoDay(new Date(y, m - 11, 1));
      else if (key === "year") from = isoDay(new Date(y, 0, 1));
      else if (key === "custom") { from = (custom && custom.from) || null; to = (custom && custom.to) || null; }
      else { from = null; to = null; }
      return { key, from, to, label: KGPeriod.describe(from, to) };
    },
    /** « Du 01/09/2026 au 15/09/2026 », « Jusqu'au … », « Toutes les dates ». */
    describe(from, to) {
      if (from && to) return `Du ${frDay(from)} au ${frDay(to)}`;
      if (from) return `Depuis le ${frDay(from)}`;
      if (to) return `Jusqu'au ${frDay(to)}`;
      return "Toutes les dates";
    },
    /** Période précédente de même durée (comparaisons), ou null. */
    previous(r) {
      if (!r || !r.from || !r.to) return null;
      const a = new Date(r.from + "T00:00:00"), b = new Date(r.to + "T00:00:00");
      const days = Math.round((b - a) / 86400000) + 1;
      const prevTo = new Date(a); prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));
      return { from: isoDay(prevFrom), to: isoDay(prevTo) };
    },
    isoDay, frDay,
  };
  window.KGPeriod = KGPeriod;

  /* -----------------------------------------------------------------------
     10c. EXPORTS — boutons PDF / Excel / CSV
     Chaque page fournit une fonction (éventuellement asynchrone) qui rend la
     description du rapport ; exports.js fabrique le fichier dans le
     navigateur. Aucun envoi de données à un service tiers.
  ----------------------------------------------------------------------- */
  const FORMAT_LABEL = { pdf: "PDF", xlsx: "Excel", csv: "CSV" };
  function exportButtons(formats) {
    return (formats || ["pdf", "xlsx", "csv"]).map(f =>
      `<button type="button" class="btn btn-ghost btn-sm btn-export" data-export="${f}" title="Télécharger en ${FORMAT_LABEL[f]}">
        <span class="fmt-dot fmt-${f}"></span>${FORMAT_LABEL[f]}</button>`).join("");
  }
  function wireExports(root, buildSpec) {
    const scope = typeof root === "string" ? $(root) : root;
    if (!scope) return;
    $$("[data-export]", scope).forEach(btn => btn.addEventListener("click", async () => {
      const format = btn.dataset.export;
      if (!window.KGExport) { toast("error", "Export indisponible", "Le module d'export n'est pas chargé."); return; }
      btn.disabled = true;
      try {
        const spec = await buildSpec(format, btn);
        if (!spec) return;
        const file = window.KGExport.download(format, spec);
        toast("success", "Téléchargement prêt", file.filename);
      } catch (err) {
        console.error(err);
        toast("error", "Export impossible", err.message || "Réessayez dans un instant.");
      } finally {
        btn.disabled = false;
      }
    }));
  }
  window.KGExportUI = { buttons: exportButtons, wire: wireExports };

  /* -----------------------------------------------------------------------
     11. SCROLL REVEAL
  ----------------------------------------------------------------------- */
  function initReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
    }, { threshold: 0.08 });
    $$(".reveal").forEach(el => io.observe(el));
  }
  window.initReveal = initReveal;

  /* -----------------------------------------------------------------------
     12. PRELOADER
  ----------------------------------------------------------------------- */
  function hidePreloader() {
    const p = $(".preloader");
    if (p) setTimeout(() => p.classList.add("done"), 550);
  }

  /* -----------------------------------------------------------------------
     13. BOOT
  ----------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", async () => {
    // --- Auth guard: protected pages require a session (when the API is live) ---
    if (document.body.hasAttribute("data-app") && window.KGAuth) {
      const ok = await window.KGAuth.requireSession("login.html");
      if (!ok) return; // redirected to login

      // Keep a lightweight online presence so @ suggestions show people
      // currently using the shared company workspace.
      const updatePresence = () => {
        if (!document.hidden && window.KGMessages) window.KGMessages.presence().catch(() => {});
      };
      updatePresence();
      window.setInterval(updatePresence, 30000);
      document.addEventListener("visibilitychange", updatePresence);

      // --- Role guard: keep salespersons out of admin-only pages & vice versa ---
      const role = await window.KGAuth.role();
      window.KG_ROLE = role;
      if (role === "relation_client") {
        const allowedPage = ["clients", "settings", "formation", "challenges", "ranking", "dashboard", "sales", "history", "guide"].includes(document.body.dataset.page);
        if (document.body.hasAttribute("data-admin-only") || !allowedPage) {
          window.location.replace("clients.html"); return;
        }
      }
      if (document.body.hasAttribute("data-admin-only") && role !== "admin") {
        window.location.replace("salesperson.html"); return;
      }
      if (document.body.hasAttribute("data-salesperson-only") && !["salesperson", "relation_client"].includes(role)) {
        window.location.replace("dashboard.html"); return;
      }
      // Un charge de relation client n'a pas de tableau de bord commercial :
      // sa page d'accueil naturelle est le portefeuille client.
    }
    // --- Hydrate window.KG with live DB rows when the API is reachable ---
    if (window.KGData) { try { await window.KGData.hydrate(); } catch (e) { console.warn(e); } }

    // Derive notifications from real activity; mark the current section as seen
    buildNotifications();
    if (document.body.dataset.page === "challenges") setSeen("chal", (window.KG.challenges || []).length);

    if (document.body.dataset.page === "messages" && window.KGMessagesBindingsReady) {
      await window.KGMessagesBindingsReady;
    }
    buildLayout();
    wireModals();
    // Draw rings
    $$("[data-ring]").forEach(drawRing);
    window.addEventListener("kg:redraw", () => $$("[data-ring]").forEach(drawRing));
    // Run page-specific hook if present (may be async)
    if (typeof window.KGPage === "function") await window.KGPage({ icon, avatar, toast, KGCharts: window.KGCharts, KGTable: initTable });
    animateCounters();
    animateBars();
    initReveal();
    initPageTour();
    hidePreloader();
  });

  // Re-fit canvases on resize (debounced) → let page re-run its chart draws
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => window.dispatchEvent(new Event("kg:redraw")), 200); });
})();
