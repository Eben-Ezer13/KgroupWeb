(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async function () {
    const form = document.getElementById("messageForm");
    if (!form) return;
    if (!(await window.KGAuth.requireSession())) return;

    const recipient = document.getElementById("recipient");
    const mentionMembers = document.getElementById("mentionMembers");
    const content = document.getElementById("messageContent");
    const list = document.getElementById("messageList");
    const loadOlder = document.getElementById("loadOlder");
    const status = document.getElementById("messageStatus");
    const unreadCount = document.getElementById("unreadCount");
    const t = (key) => window.KGI18N ? window.KGI18N.t(key) : key;
    const me = await window.KGAuth.user();
    let members;
    let loadedMessages = [];
    let hasOlder = false;

    function option(label, value) {
      const el = document.createElement("option");
      el.value = value;
      el.textContent = label;
      return el;
    }

    function renderMessages(messages) {
      const unread = messages.filter((message) => message.unread);
      unreadCount.textContent = unread.length
        ? (window.KGI18N && window.KGI18N.lang === "fr" ? `${unread.length} non lu(s)` : `${unread.length} unread`)
        : (window.KGI18N && window.KGI18N.lang === "fr" ? "Tout est lu" : "All caught up");
      if (!messages.length) {
        list.textContent = window.KGI18N && window.KGI18N.lang === "fr" ? "Aucun message pour le moment." : "No messages yet.";
        loadOlder.classList.add("hidden");
        return;
      }
      loadOlder.classList.toggle("hidden", !hasOlder);
      list.replaceChildren();
      const names = new Map(members.map((member) => [member.id, member.full_name]));
      messages.slice().reverse().forEach((message) => {
        const card = document.createElement("article");
        card.style.cssText = "padding:16px 0;border-bottom:1px solid var(--line)";
        const heading = document.createElement("div");
        heading.style.cssText = "display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap";
        const sender = document.createElement("strong");
        sender.textContent = message.sender_name || "Membre";
        const date = document.createElement("time");
        date.className = "muted";
        date.dateTime = message.created_at;
        date.textContent = new Date(message.created_at).toLocaleString(window.KGI18N && window.KGI18N.lang === "fr" ? "fr-FR" : "en-US");
        heading.append(sender, date);
        card.append(heading);
        if (message.recipient_id) {
          const privateLabel = document.createElement("small");
          privateLabel.className = "muted";
          privateLabel.textContent = window.KGI18N && window.KGI18N.lang === "fr"
            ? `Message privé · ${message.sender_id === me.id ? "à " + (message.recipient_name || "un membre") : "pour vous"}`
            : `Private message · ${message.sender_id === me.id ? "to " + (message.recipient_name || "a member") : "to you"}`;
          card.append(privateLabel);
        }
        const text = document.createElement("p");
        text.style.cssText = "white-space:pre-wrap;margin:8px 0";
        text.textContent = message.content;
        card.append(text);
        const tagged = (message.mention_ids || []).map((id) => names.get(id)).filter(Boolean);
        if (tagged.length) {
          const mentions = document.createElement("small");
          mentions.className = "muted";
          mentions.textContent = (window.KGI18N && window.KGI18N.lang === "fr" ? "Mentions : " : "Mentions: ") +
            tagged.map((name) => "@" + name).join(", ");
          card.append(mentions);
        }
        if (message.unread) {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = window.KGI18N && window.KGI18N.lang === "fr" ? "Nouveau" : "New";
          card.append(badge);
          const markRead = document.createElement("button");
          markRead.type = "button";
          markRead.className = "btn btn-ghost btn-sm";
          markRead.style.marginLeft = "8px";
          markRead.textContent = window.KGI18N && window.KGI18N.lang === "fr" ? "Marquer comme lu" : "Mark as read";
          markRead.addEventListener("click", async () => {
            markRead.disabled = true;
            try {
              await window.KGMessages.markRead([message.id]);
              message.unread = false;
              status.textContent = "";
              renderMessages(loadedMessages);
            } catch (error) {
              status.textContent = error.message || "Impossible d'enregistrer la lecture.";
              markRead.disabled = false;
            }
          });
          card.append(markRead);
        }
        list.append(card);
      });
    }

    async function loadMessages() {
      status.textContent = "";
      try {
        loadedMessages = await window.KGMessages.list(100);
        hasOlder = loadedMessages.length === 100;
        renderMessages(loadedMessages);
      } catch (error) {
        status.textContent = error.message || "Impossible de charger les messages.";
      }
    }

    try {
      members = await window.KGMessages.members();
      recipient.options[0].textContent = t("messages.team");
      members.forEach((member) => {
        recipient.append(option(member.full_name, member.id));
        mentionMembers.append(option(member.full_name, member.id));
      });
    } catch (error) {
      members = [];
      status.textContent = error.message || "Impossible de charger les membres.";
    }

    recipient.addEventListener("change", () => {
      Array.from(mentionMembers.options).forEach((item) => {
        item.disabled = Boolean(recipient.value && item.value !== recipient.value);
        if (item.disabled) item.selected = false;
      });
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const mentionIds = Array.from(mentionMembers.selectedOptions).map((item) => item.value);
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      status.textContent = "";
      try {
        await window.KGMessages.send(content.value, recipient.value, mentionIds);
        content.value = "";
        mentionMembers.selectedIndex = -1;
        await loadMessages();
        status.textContent = window.KGI18N && window.KGI18N.lang === "fr" ? "Message envoyé." : "Message sent.";
      } catch (error) {
        status.textContent = error.message || "Le message n'a pas pu être envoyé.";
      } finally {
        button.disabled = false;
      }
    });

    await loadMessages();
    loadOlder.textContent = t("messages.older");
    loadOlder.addEventListener("click", async () => {
      const firstMessage = loadedMessages[0];
      if (!firstMessage) return;
      loadOlder.disabled = true;
      status.textContent = "";
      try {
        const older = await window.KGMessages.list(100, firstMessage);
        hasOlder = older.length === 100;
        const seen = new Set(loadedMessages.map((message) => message.id));
        loadedMessages = older.filter((message) => !seen.has(message.id)).concat(loadedMessages);
        renderMessages(loadedMessages);
      } catch (error) {
        status.textContent = error.message || "Impossible de charger les anciens messages.";
      } finally {
        loadOlder.disabled = false;
      }
    });
    window.addEventListener("kg:lang", loadMessages);
  });
})();
