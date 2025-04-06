import cre from "https://unpkg.com/cre@0.3.0/cre.js";
import ghIconModule from "./gh-icon.module.js";
console.log("hey there pardner 🤠");
const nonEvents = [
  "Shift",
  "Meta",
  "Control",
  "Alt",
  "Enter",
  "Escape",
  "Backspace",
];

class App {
  constructor() {
    this.socketId = localStorage.getItem("socketId");
    this.setup();
    this.connected = false;
    this.clipped = false;
    window.clippy = this.clipboard;
    setInterval(() => {
      if (this.ws.readyState !== 1) {
        this.connected = false;
        this.teardown();
        this.setup();
        console.log("interval caught dead socket");
      }
    }, 5000);
  }
  setup = () => {
    if (!this.connected) {
      this.connected = true;
      console.log("connecting...");
      this.socketId = localStorage.getItem("socketId");
      const proto = window.location.protocol.includes("s") ? "wss://" : "ws://";
      const domain = window.location.hostname;
      const wsPath = "/ws"; // WebSocket endpoint path
      this.ws = new WebSocket(`${proto}${domain}:${window.location.port}${wsPath}`);

      this.ws.addEventListener("open", this.rootHandler);
      this.ws.addEventListener("message", this.messageHandler);
      this.ws.json = (obj) => {
        this.ws.send(JSON.stringify({
          ...obj,
          socketId: this.socketId,
        }));
      };
      window.addEventListener("keydown", this.keydownHandler);
      this.pasteListener = document.addEventListener("paste", (evt) => {
        var clipboardData = evt.clipboardData || window.clipboardData;
        var pastedText = clipboardData.getData("text/plain");
        pastedText.split("").map((char) =>
          this.ws.json({
            type: "keyPress",
            key: char,
          })
        );
        // Update internal state
        const currentMessages = this.room.messages[this.socketId];
        currentMessages.splice(
          -1,
          1,
          currentMessages.slice(-1)[0] + pastedText,
        );
        // Re-render just this user's section after paste
        renderParticipantMessages(this.socketId, currentMessages, true);
      });
    }
  };
  keydownHandler = (evt) => {
    const {
      key,
    } = evt;
    // Prevent Firefox from opening search box when '/' or "'" is pressed
    if ((key === '/' || key === "'") && navigator.userAgent.includes('Firefox')) {
      evt.preventDefault();
    }
    if (!evt.metaKey && !evt.ctrlKey) {
      const target = this.room.messages[this.socketId];
      this.ws.json({
        type: "keyPress",
        key,
      });
      const msgs = this.room.messages[this.socketId];
      if (key !== "Enter") {
        if (key === "Space") {
          msgs.splice(
            -1,
            1,
            this.room.messages[this.socketId].slice(-1)[0] + " ",
          );
        }
        if (key === "Backspace") {
          msgs.splice(
            -1,
            1,
            this.room.messages[this.socketId].slice(-1)[0].slice(0, -1),
          );
        }
        if (!nonEvents.includes(key)) {
          msgs.splice(
            -1,
            1,
            this.room.messages[this.socketId].slice(-1)[0] + key,
          );
        }
      } else { // Enter key pressed
        msgs.push("");
        // Re-render the whole section for the user on Enter to show the new empty line
        renderParticipantMessages(this.socketId, msgs, true);
      }
      // Always update the last line visually as typing happens (except Enter)
      if (key !== "Enter") {
          renderMyLast(msgs.slice(-1)[0]); // Pass the actual string content
      }
    }
  };
  teardown = () => {
    console.log("teardown hit, reconecting?");
    try {
      this.ws.close();
    } catch (e) {
      console.log("ws already closed");
    }
    window.removeEventListener("keydown", this.keydownHandler);
    document.removeEventListener("paste", this.pasteListener);
  };
  rootHandler = () => {
    this.connected = true;
    if (window.location.pathname === "/") {
      this.ws.json({
        type: "newroom",
      });
    } else {
      this.ws.json({
        type: "fetchRoom",
        id: window.location.pathname.replace("/", ""),
      });
    }
  };
  messageHandler = (raw) => {
    const body = JSON.parse(raw.data);
    if (body?.room?.yourId) {
      this.socketId = body.room.yourId;
      localStorage.setItem("socketId", this.socketId);
    }
    switch (body.type) {
      case "room-is-crowded":
        // Use the message from the server if available, otherwise use a default
        renderError(body.message || "Sorry, this room is full.");
        break;
      case "roomCreated":
        window.history.pushState(
          "chatpage",
          `Chat ${body.room.id}`,
          `/${body.room.id}`,
        );
        this.room = body.room;
        fullRender(this.socketId, this.room);
        break;
      case "gotRoom":
        if (window.location.pathname === "/") {
          window.history.pushState(
            "chatpage",
            `Chat ${body.room.id}`,
            `/${body.room.id}`,
          );
        }
        this.room = body.room;
        fullRender(this.socketId, this.room);
        break;
      case "committed":
        const commitSourceId = body.source;
        const commitTarget = this.room.messages[commitSourceId];
        if (commitTarget) {
            commitTarget.splice(-1, 1, body.final);
            commitTarget.push("");
            // Re-render the specific participant's section after commit
            renderParticipantMessages(commitSourceId, commitTarget, commitSourceId === this.socketId);
        }
        break;
      case "keyPress":
        const pressSourceId = body.source;
        const pressTarget = this.room.messages[pressSourceId];
        if (pressTarget) {
            let currentLastLine = pressTarget.slice(-1)[0];
            if (body.key === "Backspace") {
                pressTarget.splice(-1, 1, currentLastLine.slice(0, -1));
            } else if (body.key === "Space") { // Handle space explicitly if needed
                 pressTarget.splice(-1, 1, currentLastLine + " ");
            } else if (!nonEvents.includes(body.key) && body.key.length === 1) { // Basic check for printable chars
                pressTarget.splice(-1, 1, currentLastLine + body.key);
            }
            // Render only the last line update for the specific participant
            renderParticipantLast(pressSourceId, pressTarget.slice(-1)[0]);
        }
        break;
    }
  };

  clipboard = (type, rawMessage) => {
    this.clipped = true;
    renderMainHeader(this.room); // Use the correct header rendering function
    const data = [
      new ClipboardItem({
        [type]: new Blob([rawMessage], { type }),
      }),
    ];
    return navigator.clipboard.write(data);
  };
}
const app = await new App();
window.app = app;
// Update resize handler to call fullRender to recalculate heights and main header
window.addEventListener("resize", () => {
    if (window.app && window.app.room) {
        fullRender(window.app.socketId, window.app.room);
    }
});
function renderError(message) {
  // Ensure error message replaces the chat container content
  const mainDiv = document.querySelector("#main");
  const chatContainer = document.querySelector("#chat-container");
  const mainHeader = document.querySelector("#main-header"); // Keep header
  if (mainDiv) {
      // Clear existing content except header
      if(chatContainer) chatContainer.innerHTML = '';
      // Add error message within the main area (or specifically chat-container)
      const errorDiv = cre("div.error", { style: "padding: 20px; text-align: center;" }, message);
      if (chatContainer) {
          chatContainer.appendChild(errorDiv);
      } else {
          // Fallback if container doesn't exist for some reason
          mainDiv.appendChild(errorDiv);
      }
  }
   // Optionally clear or update the main header during error
   if (mainHeader) mainHeader.innerHTML = padString("Error");

}
// Helper to get the short ID
function getShortId(id) {
  return id?.substring(0, 4) || "??";
}

// Renders the messages for a single participant within their dedicated section
function renderParticipantMessages(participantId, messages, isSelf) {
  const section = document.getElementById(`participant-${participantId}`);
  if (!section) return; // Section might not exist yet

  const messagesContainer = section.querySelector(".participant-messages");
  if (!messagesContainer) return;

  let messagesDom;
  if (messages && messages.length > 0) {
    messagesDom = cre(
      "ul",
      messages.map((message, idx) =>
        // Add cursor only to the last message of the current user (isSelf)
        cre(`li${isSelf && idx === messages.length - 1 ? ".cursor" : ""}`, message)
      ),
    );
  } else {
    // Ensure even an empty section has a ul and a cursor if it's the self user
    messagesDom = cre("ul", cre(`li${isSelf ? ".cursor" : ""}`));
  }

  messagesContainer.querySelector("ul")?.remove(); // Clear previous messages
  messagesContainer.appendChild(messagesDom);
}

// Renders just the last line for the current user (optimization for typing)
function renderMyLast(message) {
  const mySection = document.getElementById(`participant-${app.socketId}`);
  if (!mySection) return;
  const lastLi = mySection.querySelector("ul li:last-of-type");
  if (lastLi) {
    lastLi.innerText = message;
  }
}

// Renders just the last line for a specific participant (optimization for typing)
function renderParticipantLast(participantId, message) {
    const section = document.getElementById(`participant-${participantId}`);
    if (!section) return;
    const lastLi = section.querySelector("ul li:last-of-type");
    if (lastLi) {
        lastLi.innerText = message;
    }
}

// Creates the DOM structure for a single participant's section
function renderParticipantSection(container, participantId, messages, isSelf, participantCount) {
  const sectionId = `participant-${participantId}`;
  let section = document.getElementById(sectionId);

  // Create section if it doesn't exist
  if (!section) {
    section = cre(`div.participant-section#${sectionId}`, [
        cre('div.participant-messages') // Container for the ul
    ]);
    // Removed participant label creation

    container.appendChild(section);
  }

  // Set height dynamically - total chat height minus header and dividers, divided by participant count
  const totalDividerHeight = (participantCount > 1 ? (participantCount - 1) : 0) * 20; // Each divider is 20px high
  const availableHeightForSections = `calc(100vh - 20px - ${totalDividerHeight}px)`; // Subtract main header (20px) and all dividers
  const sectionHeight = `calc(${availableHeightForSections} / ${participantCount})`;
  section.style.height = sectionHeight;


  // Render messages within the section
  renderParticipantMessages(participantId, messages, isSelf);
}
// if the regex is shit blame gpt, i can't be assed to do this cleaner at the moment
function linkify(inputText, copy) {
  const urlRegex =
    /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
  return inputText.replace(urlRegex, function (url) {
    return `<a href="${url}" ${copy ? 'class="copyable"' : 'target="_blank"'
      }>${url}</a>`;
  });
}

function padString(string, clip) {
  const widthInHyphens = window.innerWidth / 8;
  const padding = widthInHyphens - string.length - 4;
  const hyphens = Array.from({
    length: Math.floor(padding / 2),
  }).map(() => "-").join("");
  return `${hyphens}= <span class="message">${linkify(string, clip)
    }</span> =${hyphens}`;
}

// Renders the main header at the top
function renderMainHeader(room) {
  // Calculate count based on actual participants with messages, including self
  const participantIds = Object.keys(room?.messages || {});
  const participantCount = participantIds.length;
  const topMessageBase = `typeto.me | issues: https://github.com/jabyrd3/typeto.me2/issues`;
  let headerMessage;

  if (!room || participantCount === 0) { // Check if room exists and count > 0
      headerMessage = "Connecting or Room Invalid...";
  } else if (participantCount === 1) { // Only self in the room
    headerMessage = window.app.clipped
      ? `typeto.me | chat link copied! Send it to friends.`
      : `typeto.me | Send this URL to friends: ${window.location.href}`;
  } else {
    headerMessage = `${topMessageBase} | ${participantCount} participants in room ${room.id}`;
  }

  const paddedHeaderMessage = padString(headerMessage, participantCount <= 1)
    .replace(
      "typeto.me",
      `<a target="_blank" href="https://github.com/jabyrd3/typeto.me2">typeto.me${ghIconModule}</a>`,
    );

  const headerElement = document.querySelector("#main-header");
  if (headerElement) {
      // Pulsate effect only when waiting for the *first* other person
      headerElement.innerHTML = `<span ${participantCount === 1 ? 'class="pulsate"' : ""}>${paddedHeaderMessage}</span>`;
  }


  // Re-attach copy listeners as innerHTML overwrites them
  const copyableLinks = document.querySelectorAll("#main-header .copyable"); // Scope query to header
  for (let i = 0; i < copyableLinks.length; i++) {
    const link = copyableLinks[i];
    link.addEventListener("click", (e) => {
      e.preventDefault();
      window.app.clipboard("text/plain", e.srcElement.href);
    });
  }
}

// Helper function to generate a padded string of dashes, optionally centering a participant ID
function renderDividerLine(participantId = null) {
    const widthInChars = Math.floor(window.innerWidth / 8); // Approx width based on char width
    let lineContent;

    if (participantId) {
        const shortId = getShortId(participantId);
        const label = ` ^^ ${shortId} ^^ `; // Add ^^ markers around the short ID
        const labelLength = label.length;
        const remainingWidth = widthInChars - labelLength;
        const sideDashesCount = Math.max(0, Math.floor(remainingWidth / 2));
        const dashes = Array.from({ length: sideDashesCount }).map(() => "-").join("");
        // Wrap the label in a span for specific styling (e.g., background)
        lineContent = `${dashes}<span class="divider-label">${label}</span>${dashes}`;
        // Ensure the line roughly fills the width if label is long
        if (dashes.length * 2 + labelLength < widthInChars - 2) {
             lineContent += "-"; // Add extra dash if needed
        }
    } else {
        // Just dashes if no ID provided
        lineContent = Array.from({ length: widthInChars }).map(() => "-").join("");
    }
    return lineContent;
}


// Main render function: Clears container and renders all participant sections
function fullRender(socketID, room) {
  renderMainHeader(room); // Render the single top header

  const container = document.getElementById("chat-container");
  if (!container) return; // Exit if container doesn't exist yet
  container.innerHTML = ""; // Clear previous sections

  const participantIds = Object.keys(room.messages || {});
  const participantCount = participantIds.length;

  if (participantCount === 0) {
      // Handle case with no participants (e.g., initial load error?)
      container.innerHTML = '<div style="text-align: center; padding-top: 20px;">Waiting for room data...</div>';
      return;
  }

  let renderedCount = 0; // Keep track of rendered sections to place dividers correctly

  // Function to render a section and potentially a divider
  const renderSectionAndDivider = (id, isSelf) => {
      renderParticipantSection(container, id, room.messages[id], isSelf, participantCount);
      renderedCount++;
      // Add divider after this section if it's not the very last section overall
      if (renderedCount < participantCount) {
          // Pass the ID only if the section just rendered was NOT the self section
          const dividerContent = renderDividerLine(isSelf ? null : id);
          const divider = cre('div.divider-line');
          divider.innerHTML = dividerContent; // Use innerHTML because the content now includes HTML span
          container.appendChild(divider);
      }
  };

  // Render other participants first
  participantIds.forEach(id => {
    if (id !== socketID) {
      renderSectionAndDivider(id, false);
    }
  });

  // Render own section last
  if (room.messages[socketID]) {
      renderSectionAndDivider(socketID, true);
  }
}
