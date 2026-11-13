(function () {
  "use strict";

  let resolveBindings;
  window.KGMessagesBindingsReady = new Promise((resolve) => { resolveBindings = resolve; });

  document.addEventListener("DOMContentLoaded", async function () {
    const composer = document.getElementById("messageForm");
    if (!composer) { resolveBindings(false); return; }
    if (!(await window.KGAuth.requireSession())) { resolveBindings(false); return; }

    const list = document.getElementById("messageList");
    const timeline = document.getElementById("messageTimeline");
    const loadOlder = document.getElementById("loadOlder");
    const status = document.getElementById("messageStatus");
    const unreadCount = document.getElementById("unreadCount");
    const content = document.getElementById("messageContent");
    const highlight = document.getElementById("messageHighlight");
    const picker = document.getElementById("mentionPicker");
    const replyPreview = document.getElementById("replyPreview");
    const replyPreviewText = document.getElementById("replyPreviewText");
    const copy = {
      en: {
        team: "Company group", teamHint: "Everyone in the company can read these messages.",
        privateHint: "Private conversation · only visible to its participants.",
        direct: "Private messages", empty: "No messages yet. Start the conversation.", reply: "Reply",
        membersLoading: "Loading platform members…", membersUnavailable: "Platform members could not be loaded.",
        noPrivateMembers: "No other platform members are available for a private conversation.",
        retryMembers: "Try again",
        unread: (count) => `${count} unread`, allRead: "All caught up",
        sendError: "Your message could not be sent. Please try again.", delete: "Delete", deleteConfirm: "Delete this message? This cannot be undone.",
        deleteError: "This message could not be deleted. Please try again.",
        loadError: "Could not load messages.", olderError: "Could not load earlier messages.",
        chooseMention: "Platform members", noMembers: "No platform members available.", online: "Online", offline: "Offline",
        react: "React to this message", reactionError: "Could not save your reaction.",
        mentionLimit: "You can tag up to 20 people in one message.",
        privateBlocked: "A private conversation can only mention the person in this conversation.",
        older: "Load earlier messages", name: "Platform member",
      },
      fr: {
        team: "Groupe de l'entreprise", teamHint: "Toutes les personnes de l'entreprise peuvent lire ces messages.",
        privateHint: "Conversation privée · visible uniquement par ses participants.",
        direct: "Messages privés", empty: "Aucun message pour le moment. Lancez la discussion.", reply: "Répondre",
        membersLoading: "Chargement des membres de la plateforme…", membersUnavailable: "Impossible de charger les membres de la plateforme.",
        noPrivateMembers: "Aucun autre membre de la plateforme n'est disponible pour une conversation privée.",
        retryMembers: "Réessayer",
        unread: (count) => `${count} message(s) non lu(s)`, allRead: "Tout est à jour",
        sendError: "Votre message n'a pas pu être envoyé. Réessayez.", delete: "Supprimer", deleteConfirm: "Supprimer ce message ? Cette action est irréversible.",
        deleteError: "Ce message n'a pas pu être supprimé. Réessayez.",
        loadError: "Impossible de charger les messages.", olderError: "Impossible de charger les anciens messages.",
        chooseMention: "Membres de la plateforme", noMembers: "Aucun membre de la plateforme disponible.", online: "En ligne", offline: "Hors ligne",
        react: "Réagir à ce message", reactionError: "Impossible d'enregistrer votre réaction.",
        mentionLimit: "Vous pouvez mentionner jusqu'à 20 personnes par message.",
        privateBlocked: "Dans une conversation privée, seule la personne en face peut être mentionnée.",
        older: "Charger les messages précédents", name: "Membre de la plateforme",
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
    let reloadPending = false;
    let pendingLoad = null;
    let memberError = "";
    let membersLoading = true;
    let membersRequest = null;
    let mentionMatches = [];
    let mentionIndex = -1;
    let activeMention = null;
    const pendingReactions = new Set();
    const reactionEmojis = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🎉", "🔥"];

    function memberName(id) {
      const member = members.find((item) => item.id === id);
      return member && member.full_name ? member.full_name : text("name");
    }

    function setTeamAvatar(element) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.7");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>';
      element.replaceChildren(svg);
    }

    function renderComposerHighlights() {
      if (!highlight) return;
      const value = content.value;
      const tags = Array.from(taggedIds)
        .map((id) => `@${memberName(id)}`)
        .filter((tag) => tag.length > 1)
        .sort((a, b) => b.length - a.length);
      highlight.replaceChildren();
      let cursor = 0;
      while (cursor < value.length) {
        let best = null;
        for (const tag of tags) {
          let index = value.indexOf(tag, cursor);
          while (index >= 0) {
            const next = value[index + tag.length] || "";
            if (!next || /[\s.,!?;:)]/.test(next)) break;
            index = value.indexOf(tag, index + 1);
          }
          if (index >= 0 && (!best || index < best.index || (index === best.index && tag.length > best.tag.length))) {
            best = { index, tag };
          }
        }
        if (!best) {
          highlight.append(document.createTextNode(value.slice(cursor)));
          break;
        }
        if (best.index > cursor) highlight.append(document.createTextNode(value.slice(cursor, best.index)));
        const token = document.createElement("span");
        token.className = "chat-mention-token";
        token.textContent = best.tag;
        highlight.append(token);
        cursor = best.index + best.tag.length;
      }
      if (!value.length) highlight.textContent = "";
      highlight.scrollTop = content.scrollTop;
      highlight.scrollLeft = content.scrollLeft;
    }

    function addConversationButton(label, peerId, kind, isOnline) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-conversation";
      button.dataset.conversation = peerId || "team";
      button.setAttribute("role", "listitem");
      const avatar = document.createElement("span");
      avatar.className = "chat-conversation-avatar";
      if (kind === "team") setTeamAvatar(avatar);
      else avatar.textContent = label.trim().charAt(0).toUpperCase();
      const details = document.createElement("span");
      details.className = "chat-conversation-details";
      const name = document.createElement("strong");
      name.textContent = label;
      const subtitle = document.createElement("small");
      if (kind !== "team") {
        subtitle.className = "chat-presence";
        subtitle.dataset.online = isOnline ? "true" : "false";
      }
      subtitle.textContent = kind === "team" ? text("teamHint")
        : `${isOnline ? text("online") : text("offline")} · ${text("privateHint")}`;
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
        members.forEach((member) => addConversationButton(member.full_name || text("name"), member.id, "direct", member.online));
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
      if (isTeam) setTeamAvatar(conversationAvatar);
      else conversationAvatar.textContent = title.trim().charAt(0).toUpperCase();
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
          const mentions = document.createElement("div");
          mentions.className = "chat-message-mentions";
          tagged.forEach((name) => {
            const badge = document.createElement("span");
            badge.className = "chat-mention-pill";
            badge.textContent = `@ ${name}`;
            mentions.append(badge);
          });
          bubble.append(mentions);
        }
        card.append(bubble);
        const actions = document.createElement("div");
        actions.className = "chat-message-actions";
        const actionRow = document.createElement("div");
        actionRow.className = "chat-message-action-row";
        const reactionTools = document.createElement("div");
        reactionTools.className = "chat-reaction-tools";
        const reactionList = document.createElement("div");
        reactionList.className = "chat-reaction-list";
        (message.reactions || []).forEach((reaction) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = `chat-reaction-chip${reaction.reacted ? " reacted" : ""}`;
          chip.textContent = `${reaction.emoji} ${reaction.count}`;
          chip.title = text("react");
          chip.setAttribute("aria-label", `${reaction.emoji}, ${reaction.count}`);
          chip.disabled = pendingReactions.has(message.id);
          chip.addEventListener("click", () => toggleReaction(message, reaction.emoji));
          reactionList.append(chip);
        });
        const picker = document.createElement("div");
        picker.className = "chat-reaction-picker hidden";
        picker.setAttribute("role", "group");
        picker.setAttribute("aria-label", text("react"));
        reactionEmojis.forEach((emoji) => {
          const option = document.createElement("button");
          option.type = "button";
          option.className = "chat-reaction-option";
          option.textContent = emoji;
          option.setAttribute("aria-label", emoji);
          option.disabled = pendingReactions.has(message.id);
          option.addEventListener("click", () => toggleReaction(message, emoji));
          picker.append(option);
        });
        const reactButton = document.createElement("button");
        reactButton.type = "button";
        reactButton.className = "chat-react-button";
        reactButton.textContent = "☺ +";
        reactButton.title = text("react");
        reactButton.setAttribute("aria-label", text("react"));
        reactButton.setAttribute("aria-expanded", "false");
        reactButton.disabled = pendingReactions.has(message.id);
        reactButton.addEventListener("click", () => {
          const open = picker.classList.toggle("hidden") === false;
          reactButton.setAttribute("aria-expanded", String(open));
        });
        reactionTools.append(reactionList, reactButton, picker);
        const replyButton = document.createElement("button");
        replyButton.type = "button";
        replyButton.className = "chat-reply-button";
        replyButton.textContent = text("reply");
        replyButton.addEventListener("click", () => setReply(message));
        actionRow.append(reactionTools, replyButton);
        if (own) {
          const deleteButton = document.createElement("button");
          deleteButton.type = "button";
          deleteButton.className = "chat-delete-button";
          deleteButton.textContent = text("delete");
          deleteButton.addEventListener("click", () => deleteMessage(message));
          actionRow.append(deleteButton);
        }
        actions.append(actionRow);
        card.append(actions);
        list.append(card);
      });
      loadOlder.classList.toggle("hidden", !hasOlder);
      loadOlder.textContent = text("older");
      unreadCount.textContent = unread ? text("unread", unread) : text("allRead");
      unreadCount.dataset.unread = String(unread);
      unreadCount.classList.toggle("is-current", unread === 0);
      if (keepPosition) timeline.scrollTop = timeline.scrollHeight - oldHeight + oldTop;
      else timeline.scrollTop = timeline.scrollHeight;
    }

    async function toggleReaction(message, emoji) {
      if (pendingReactions.has(message.id)) return;
      pendingReactions.add(message.id);
      const card = list.querySelector(`[data-message-id="${message.id}"]`);
      card && card.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try {
        const result = await window.KGMessages.react(message.id, emoji);
        message.reactions = result.reactions || [];
        renderMessages(true);
      } catch (error) {
        status.textContent = error.message || text("reactionError");
      } finally {
        pendingReactions.delete(message.id);
      }
    }

    async function deleteMessage(message) {
      if (!window.confirm(text("deleteConfirm"))) return;
      const card = list.querySelector(`[data-message-id="${message.id}"]`);
      card && card.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      status.textContent = "";
      try {
        await window.KGMessages.delete(message.id);
        loadedMessages = loadedMessages.filter((item) => item.id !== message.id);
        renderMessages(true);
      } catch (error) {
        status.textContent = error.message || text("deleteError");
        card && card.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      }
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
      if (loading) {
        reloadPending = true;
        return pendingLoad;
      }
      loading = true;
      status.textContent = "";
      pendingLoad = (async () => {
        let nextOptions = options;
        do {
          reloadPending = false;
          const current = activeConversation;
          const wasNearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 120;
          try {
            const messages = await window.KGMessages.list(100, nextOptions && nextOptions.cursor, current);
            if (current !== activeConversation) {
              reloadPending = true;
            } else {
              if (nextOptions && nextOptions.older) {
                const existing = new Set(loadedMessages.map((message) => message.id));
                loadedMessages = messages.filter((message) => !existing.has(message.id)).concat(loadedMessages);
              } else loadedMessages = messages;
              hasOlder = messages.length === 100;
              await markVisibleRead(messages);
              renderMessages(Boolean(nextOptions && nextOptions.older) || !wasNearBottom);
            }
          } catch (error) {
            status.textContent = error.message || (nextOptions && nextOptions.older ? text("olderError") : text("loadError"));
          }
          nextOptions = null;
        } while (reloadPending);
      })();
      try { await pendingLoad; }
      finally { loading = false; pendingLoad = null; }
    }

    async function selectConversation(conversation) {
      if (conversation === activeConversation && loadedMessages.length) return;
      activeConversation = conversation;
      loadedMessages = [];
      hasOlder = false;
      setReply(null);
      taggedIds.clear();
      picker.classList.add("hidden");
      activeMention = null;
      mentionMatches = [];
      mentionIndex = -1;
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
      const token = activeMention;
      if (!token) return;
      const start = token.start;
      const end = content.selectionEnd;
      const value = content.value;
      const replacement = `@${member.full_name} `;
      content.value = value.slice(0, start) + replacement + value.slice(end);
      const caret = start + replacement.length;
      content.setSelectionRange(caret, caret);
      content.focus();
      taggedIds.add(member.id);
      renderComposerHighlights();
      picker.classList.add("hidden");
      activeMention = null;
      mentionMatches = [];
      mentionIndex = -1;
    }

    function allowedMentionMembers(query) {
      const available = activeConversation === "team"
        ? members
        : members.filter((member) => member.id === activeConversation);
      const normalized = String(query || "").trim().toLocaleLowerCase();
      return available.filter((member) => !normalized || String(member.full_name || "").toLocaleLowerCase().startsWith(normalized));
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
      mentionMatches = allowedMentionMembers(activeMention && activeMention.query);
      if (!mentionMatches.length) {
        const empty = document.createElement("span");
        empty.className = "chat-mention-empty";
        empty.textContent = text("noMembers");
        picker.append(empty);
        return;
      }
      const label = document.createElement("span");
      label.className = "chat-mention-label";
      label.textContent = text("chooseMention");
      picker.append(label);
      mentionMatches.forEach((member, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-mention-option";
        button.textContent = "@ " + member.full_name;
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", index === mentionIndex ? "true" : "false");
        if (index === mentionIndex) button.classList.add("selected");
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => insertMention(member));
        picker.append(button);
      });
    }

    document.getElementById("cancelReply").addEventListener("click", () => setReply(null));

    function refreshMentionPicker() {
      renderComposerHighlights();
      const caret = content.selectionStart;
      const before = content.value.slice(0, caret);
      const match = /(^|[^A-Za-z0-9._%+-])@([^\n]*)$/.exec(before);
      if (!match) {
        activeMention = null;
        mentionMatches = [];
        mentionIndex = -1;
        picker.classList.add("hidden");
        return;
      }
      const query = match[2];
      const normalized = query.trim().toLocaleLowerCase();
      const complete = normalized && members.some((member) => String(member.full_name || "").toLocaleLowerCase() === normalized);
      if (complete && /\s$/.test(query)) {
        activeMention = null;
        mentionMatches = [];
        mentionIndex = -1;
        picker.classList.add("hidden");
        return;
      }
      activeMention = { start: match.index + match[1].length, query };
      mentionIndex = -1;
      picker.classList.remove("hidden");
      renderMentionPicker();
    }

    content.addEventListener("input", refreshMentionPicker);
    content.addEventListener("scroll", renderComposerHighlights);
    content.addEventListener("click", refreshMentionPicker);
    content.addEventListener("keyup", (event) => {
      if (["ArrowUp", "ArrowDown", "Escape", "Enter"].includes(event.key)) return;
      refreshMentionPicker();
    });

    async function sendMessage() {
      const message = content.value.trim();
      if (!message) return;
      const recipientId = activeConversation === "team" ? null : activeConversation;
      const mentionIds = Array.from(taggedIds).filter((id) => message.includes(`@${memberName(id)}`));
      const sentConversation = activeConversation;
      const quotedMessage = replyTo;
      const button = document.getElementById("sendMessage");
      if (button.disabled) return;
      button.disabled = true;
      status.textContent = "";
      try {
        const sent = await window.KGMessages.send(message, recipientId, mentionIds, quotedMessage && quotedMessage.id);
        content.value = "";
        renderComposerHighlights();
        taggedIds.clear();
        setReply(null);
        if (activeConversation === sentConversation && sent && sent.id) {
          loadedMessages.push({
            ...sent,
            sender_name: window.KG && window.KG.me && window.KG.me.name || me.email,
            reply_to_id: quotedMessage && quotedMessage.id || null,
            reply_content: quotedMessage && quotedMessage.content || null,
            reply_sender_name: quotedMessage && quotedMessage.sender_name || null,
            unread: false,
          });
          loadedMessages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          hasOlder = hasOlder || loadedMessages.length > 100;
          renderMessages(false);
        }
        await loadMessages();
      } catch {
        status.textContent = text("sendError");
      } finally {
        button.disabled = false;
      }
    }

    document.getElementById("sendMessage").addEventListener("click", sendMessage);

    content.addEventListener("keydown", (event) => {
      if (!picker.classList.contains("hidden")) {
        if (event.key === "ArrowDown" && mentionMatches.length) {
          event.preventDefault();
          mentionIndex = (mentionIndex + 1) % mentionMatches.length;
          renderMentionPicker();
          return;
        }
        if (event.key === "ArrowUp" && mentionMatches.length) {
          event.preventDefault();
          mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
          renderMentionPicker();
          return;
        }
        if (event.key === "Enter" && !event.shiftKey && mentionMatches.length) {
          event.preventDefault();
          insertMention(mentionMatches[Math.max(mentionIndex, 0)]);
          return;
        }
        if (event.key === "Escape") {
          picker.classList.add("hidden");
          activeMention = null;
          mentionMatches = [];
          mentionIndex = -1;
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage();
      }
    });

    // The shared shell waits for these handlers before revealing the page.
    // This prevents an early click from landing in the gap between auth and
    // async message initialization.
    resolveBindings(true);

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
          if (activeMention) refreshMentionPicker();
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
      if (activeMention) refreshMentionPicker();
    });
    window.setInterval(() => {
      if (!document.hidden) loadMessages();
    }, 12000);
    window.setInterval(() => {
      if (!document.hidden) loadMembers();
    }, 45000);
  });
})();
