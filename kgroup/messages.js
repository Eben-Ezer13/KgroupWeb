(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", async function () {
    const form = document.getElementById("messageForm");
    if (!form) return;
    if (!(await window.KGAuth.requireSession())) return;

    const list = document.getElementById("messageList");
    const timeline = document.getElementById("messageTimeline");
    const loadOlder = document.getElementById("loadOlder");
    const status = document.getElementById("messageStatus");
    const unreadCount = document.getElementById("unreadCount");
    const content = document.getElementById("messageContent");
    const picker = document.getElementById("mentionPicker");
    const mentionToggle = document.getElementById("mentionToggle");
    const replyPreview = document.getElementById("replyPreview");
    const replyPreviewText = document.getElementById("replyPreviewText");
    const copy = {
      en: {
        team: "Team discussion", teamHint: "Everyone on your team can read these messages.",
        privateHint: "Private conversation · only visible to its participants.",
        direct: "Private messages", empty: "No messages yet. Start the conversation.", reply: "Reply",
        membersLoading: "Loading teammates…", membersUnavailable: "Teammates could not be loaded.",
        noPrivateMembers: "No other teammates are available for a private conversation.",
        retryMembers: "Try again",
        unread: (count) => `${count} unread`, allRead: "All caught up",
        sent: "Message sent.", sendError: "Could not send this message.",
        loadError: "Could not load messages.", olderError: "Could not load earlier messages.",
        chooseMention: "Choose someone to mention", noMembers: "No teammates to mention.",
        mentionLimit: "You can tag up to 20 people in one message.",
        privateBlocked: "A private conversation can only mention the person in this conversation.",
        older: "Load earlier messages", name: "Team member",
      },
      fr: {
        team: "Discussion de l'équipe", teamHint: "Tous les membres de l'équipe peuvent lire ces messages.",
        privateHint: "Conversation privée · visible uniquement par ses participants.",
        direct: "Messages privés", empty: "Aucun message pour le moment. Lancez la discussion.", reply: "Répondre",
        membersLoading: "Chargement des collègues…", membersUnavailable: "Impossible de charger les collègues.",
        noPrivateMembers: "Aucun autre collègue n'est disponible pour une conversation privée.",
        retryMembers: "Réessayer",
        unread: (count) => `${count} message(s) non lu(s)`, allRead: "Tout est à jour",
        sent: "Message envoyé.", sendError: "Impossible d'envoyer ce message.",
        loadError: "Impossible de charger les messages.", olderError: "Impossible de charger les anciens messages.",
        chooseMention: "Choisir une personne à mentionner", noMembers: "Aucun collègue à mentionner.",
        mentionLimit: "Vous pouvez mentionner jusqu'à 20 personnes par message.",
        privateBlocked: "Dans une conversation privée, seule la personne en face peut être mentionnée.",
        older: "Charger les messages précédents", name: "Membre de l'équipe",
      },
    };
    const lang = () => window.KGI18N && window.KGI18N.lang === "fr" ? "fr" : "en";
    const text = (key, ...args) => {
      const value = copy[lang()][key];
      return typeof value === "function" ? value(...args) : value;
    };
    const me = await window.KGAuth.user();
    const conversationList = document.getElementById("conversationList");
    const conversationTitle = document.getElementById("conversationTitle");
    const conversationSubtitle = document.getElementById("conversationSubtitle");
    const conversationAvatar = document.getElementById("conversationAvatar");
    const members = [];
    const taggedIds = new Set();
    let activeConversation = "team";
    let loadedMessages = [];
    let replyTo = null;
    let hasOlder = false;
    let loading = false;
    let memberError = "";
    let membersLoading = true;
    let membersRequest = null;

    function memberName(id) {
      const member = members.find((item) => item.id === id);
      return member ? member.full_name : text("name");
    }

    function addConversationButton(label, peerId, kind) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-conversation";
      button.dataset.conversation = peerId || "team";
      button.setAttribute("role", "listitem");
      const avatar = document.createElement("span");
      avatar.className = "chat-conversation-avatar";
      avatar.textContent = kind === "team" ? "É" : label.trim().charAt(0).toUpperCase();
      const details = document.createElement("span");
      details.className = "chat-conversation-details";
      const name = document.createElement("strong");
      name.textContent = label;
      const subtitle = document.createElement("small");
      subtitle.textContent = kind === "team" ? text("teamHint") : text("privateHint");
      details.append(name, subtitle);
      button.append(avatar, details);
      button.addEventListener("click", () => selectConversation(peerId || "team"));
      conversationList.append(button);
    }

    function renderConversationList() {
      conversationList.replaceChildren();
      addConversationButton(text("team"), null, "team");
      const divider = document.createElement("div");
      divider.className = "chat-list-label";
      divider.textContent = text("direct");
      conversationList.append(divider);
      if (membersLoading) {
        const loadingNotice = document.createElement("p");
        loadingNotice.className = "chat-list-notice";
        loadingNotice.textContent = text("membersLoading");
        conversationList.append(loadingNotice);
      } else if (memberError) {
        const notice = document.createElement("div");
        notice.className = "chat-list-notice";
        const message = document.createElement("p");
        message.textContent = text("membersUnavailable");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "btn btn-ghost btn-sm";
        retry.textContent = text("retryMembers");
        retry.addEventListener("click", loadMembers);
        notice.append(message, retry);
        conversationList.append(notice);
      } else if (!members.length) {
        const empty = document.createElement("p");
        empty.className = "chat-list-notice";
        empty.textContent = text("noPrivateMembers");
        conversationList.append(empty);
      } else {
        members.forEach((member) => addConversationButton(member.full_name, member.id, "direct"));
      }
      markActiveConversation();
    }

    function markActiveConversation() {
      conversationList.querySelectorAll(".chat-conversation").forEach((button) => {
        const selected = button.dataset.conversation === activeConversation;
        button.classList.toggle("active", selected);
        button.setAttribute("aria-current", selected ? "true" : "false");
      });
    }

    function updateHeader() {
      const isTeam = activeConversation === "team";
      const title = isTeam ? text("team") : memberName(activeConversation);
      conversationTitle.textContent = title;
      conversationSubtitle.textContent = isTeam ? text("teamHint") : text("privateHint");
      conversationAvatar.textContent = isTeam ? "É" : title.trim().charAt(0).toUpperCase();
      conversationAvatar.classList.toggle("team", isTeam);
    }

    function setReply(message) {
      replyTo = message;
      replyPreview.classList.toggle("hidden", !message);
      if (message) {
        replyPreviewText.textContent = `${message.sender_name || text("name")} : ${message.content}`;
        content.focus();
      }
    }

    function formatDate(value) {
      return new Date(value).toLocaleString(lang() === "fr" ? "fr-FR" : "en-US", {
        dateStyle: "short", timeStyle: "short",
      });
    }

    function renderMessages(keepPosition) {
      const oldHeight = timeline.scrollHeight;
      const oldTop = timeline.scrollTop;
      const unread = loadedMessages.filter((message) => message.unread).length;
      list.replaceChildren();
      if (!loadedMessages.length) {
        const empty = document.createElement("p");
        empty.className = "chat-empty";
        empty.textContent = text("empty");
        list.append(empty);
      }
      loadedMessages.forEach((message) => {
        const own = message.sender_id === me.id;
        const card = document.createElement("article");
        card.className = `chat-message${own ? " own" : ""}`;
        card.dataset.messageId = message.id;

        if (message.reply_to_id && message.reply_content) {
          const quoted = document.createElement("div");
          quoted.className = "chat-message-quote";
          const quoteName = document.createElement("strong");
          quoteName.textContent = message.reply_sender_name || text("name");
          const quoteContent = document.createElement("span");
          quoteContent.textContent = message.reply_content;
          quoted.append(quoteName, quoteContent);
          card.append(quoted);
        }

        const bubble = document.createElement("div");
        bubble.className = "chat-message-bubble";
        const heading = document.createElement("div");
        heading.className = "chat-message-heading";
        const sender = document.createElement("strong");
        sender.textContent = own ? (window.KG && window.KG.me && window.KG.me.name) || text("name") : message.sender_name || text("name");
        const date = document.createElement("time");
        date.dateTime = message.created_at;
        date.textContent = formatDate(message.created_at);
        heading.append(sender, date);
        const body = document.createElement("p");
        body.className = "chat-message-content";
        body.textContent = message.content;
        bubble.append(heading, body);

        const tagged = (message.mention_ids || []).map((id) => memberName(id));
        if (tagged.length) {
          const mentions = document.createElement("small");
          mentions.className = "chat-message-mentions";
          mentions.textContent = `@ ${tagged.join(", @ ")}`;
          bubble.append(mentions);
        }
        card.append(bubble);
        const actions = document.createElement("div");
        actions.className = "chat-message-actions";
        const replyButton = document.createElement("button");
        replyButton.type = "button";
        replyButton.className = "chat-reply-button";
        replyButton.textContent = text("reply");
        replyButton.addEventListener("click", () => setReply(message));
        actions.append(replyButton);
        card.append(actions);
        list.append(card);
      });
      loadOlder.classList.toggle("hidden", !hasOlder);
      loadOlder.textContent = text("older");
      unreadCount.textContent = unread ? text("unread", unread) : text("allRead");
      if (keepPosition) timeline.scrollTop = timeline.scrollHeight - oldHeight + oldTop;
      else timeline.scrollTop = timeline.scrollHeight;
    }

    async function markVisibleRead(messages) {
      const ids = messages.filter((message) => message.unread).map((message) => message.id);
      if (!ids.length) return;
      try {
        await window.KGMessages.markRead(ids);
        loadedMessages.forEach((message) => {
          if (ids.includes(message.id)) message.unread = false;
        });
      } catch (error) {
        status.textContent = error.message || text("loadError");
      }
    }

    async function loadMessages(options) {
      if (loading) return;
      loading = true;
      status.textContent = "";
      const wasNearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 120;
      try {
        const current = activeConversation;
        const messages = await window.KGMessages.list(100, options && options.cursor, current);
        if (current !== activeConversation) return;
        if (options && options.older) {
          const existing = new Set(loadedMessages.map((message) => message.id));
          loadedMessages = messages.filter((message) => !existing.has(message.id)).concat(loadedMessages);
        } else {
          loadedMessages = messages;
        }
        hasOlder = messages.length === 100;
        await markVisibleRead(messages);
        renderMessages(Boolean(options && options.older) || !wasNearBottom);
      } catch (error) {
        status.textContent = error.message || (options && options.older ? text("olderError") : text("loadError"));
      } finally {
        loading = false;
      }
    }

    async function selectConversation(conversation) {
      if (conversation === activeConversation && loadedMessages.length) return;
      activeConversation = conversation;
      loadedMessages = [];
      hasOlder = false;
      setReply(null);
      taggedIds.clear();
      picker.classList.add("hidden");
      mentionToggle.setAttribute("aria-expanded", "false");
      status.textContent = "";
      updateHeader();
      markActiveConversation();
      await loadMessages();
    }

    function insertMention(member) {
      if (!taggedIds.has(member.id) && taggedIds.size >= 20) {
        status.textContent = text("mentionLimit");
        return;
      }
      const start = content.selectionStart;
      const end = content.selectionEnd;
      const value = content.value;
      const at = value.lastIndexOf("@", start - 1);
      const token = at >= 0 && !/\s/.test(value.slice(at + 1, start)) ? at : start;
      const replacement = `@${member.full_name} `;
      content.value = value.slice(0, token) + replacement + value.slice(end);
      const caret = token + replacement.length;
      content.setSelectionRange(caret, caret);
      content.focus();
      taggedIds.add(member.id);
      picker.classList.add("hidden");
      mentionToggle.setAttribute("aria-expanded", "false");
    }

    function renderMentionPicker() {
      picker.replaceChildren();
      if (membersLoading) {
        const loadingNotice = document.createElement("span");
        loadingNotice.className = "chat-mention-empty";
        loadingNotice.textContent = text("membersLoading");
        picker.append(loadingNotice);
        return;
      }
      if (memberError) {
        const notice = document.createElement("span");
        notice.className = "chat-mention-empty";
        notice.textContent = text("membersUnavailable");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "btn btn-ghost btn-sm";
        retry.textContent = text("retryMembers");
        retry.addEventListener("click", async () => {
          await loadMembers();
          if (!picker.classList.contains("hidden")) renderMentionPicker();
        });
        picker.append(notice, retry);
        return;
      }
      const allowed = activeConversation === "team"
        ? members
        : members.filter((member) => member.id === activeConversation);
      if (!allowed.length) {
        const empty = document.createElement("span");
        empty.className = "chat-mention-empty";
        empty.textContent = activeConversation === "team" ? text("noMembers") : text("privateBlocked");
        picker.append(empty);
        return;
      }
      const label = document.createElement("span");
      label.className = "chat-mention-label";
      label.textContent = text("chooseMention");
      picker.append(label);
      allowed.forEach((member) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-mention-option";
        button.textContent = "@ " + member.full_name;
        button.addEventListener("click", () => insertMention(member));
        picker.append(button);
      });
    }

    document.getElementById("cancelReply").addEventListener("click", () => setReply(null));
    mentionToggle.addEventListener("click", async () => {
      const opening = picker.classList.contains("hidden");
      if (!opening) {
        picker.classList.add("hidden");
        mentionToggle.setAttribute("aria-expanded", "false");
        return;
      }
      picker.classList.remove("hidden");
      mentionToggle.setAttribute("aria-expanded", "true");
      const refresh = loadMembers();
      renderMentionPicker();
      await refresh;
      if (!picker.classList.contains("hidden")) renderMentionPicker();
    });

    content.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
      if (event.key === "Escape" && !picker.classList.contains("hidden")) {
        picker.classList.add("hidden");
        mentionToggle.setAttribute("aria-expanded", "false");
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = content.value.trim();
      if (!message) return;
      const recipientId = activeConversation === "team" ? null : activeConversation;
      const mentionIds = Array.from(taggedIds).filter((id) => message.includes(`@${memberName(id)}`));
      const button = document.getElementById("sendMessage");
      button.disabled = true;
      status.textContent = "";
      try {
        await window.KGMessages.send(message, recipientId, mentionIds, replyTo && replyTo.id);
        content.value = "";
        taggedIds.clear();
        setReply(null);
        await loadMessages();
        status.textContent = text("sent");
      } catch (error) {
        status.textContent = error.message || text("sendError");
      } finally {
        button.disabled = false;
      }
    });

    loadOlder.addEventListener("click", async () => {
      const firstMessage = loadedMessages[0];
      if (!firstMessage || loading) return;
      loadOlder.disabled = true;
      await loadMessages({ older: true, cursor: firstMessage });
      loadOlder.disabled = false;
    });

    async function loadMembers() {
      if (membersRequest) return membersRequest;
      membersLoading = true;
      memberError = "";
      renderConversationList();
      membersRequest = (async () => {
        try {
          const loadedMembers = await window.KGMessages.members();
          if (!Array.isArray(loadedMembers)) throw new Error(text("membersUnavailable"));
          members.splice(0, members.length, ...loadedMembers);
        } catch (error) {
          memberError = error.message || text("membersUnavailable");
        } finally {
          membersLoading = false;
          renderConversationList();
        }
      })();
      try {
        await membersRequest;
      } finally {
        membersRequest = null;
      }
    }

    renderConversationList();
    updateHeader();

    await loadMembers();
    await loadMessages();
    window.addEventListener("kg:lang", () => {
      renderConversationList();
      updateHeader();
      renderMessages(true);
    });
    window.setInterval(() => {
      if (!document.hidden) loadMessages();
    }, 12000);
  });
})();
