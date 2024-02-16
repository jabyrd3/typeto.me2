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
  setupInput = () => {
    const inputElement = document.getElementById("focused-input");
    document.getElementById('main').addEventListener('touchend', function() {
        inputElement.focus();
    });
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
        this.room.messages[this.socketId].splice(
          -1,
          1,
          this.room.messages[this.socketId].slice(-1)[0] + pastedText,
        );
        renderMine(this.socketId, this.room);
      });
    }
    this.setupInput();
  };
  keydownHandler = (evt) => {
    const {
      key,
    } = evt;
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
      } else {
        msgs.push("");
        renderMine(this.socketId, this.room);
      }
      renderMyLast(msgs.slice(-1));
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
        renderError();
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
        const commitTarget = this.room.messages[body.source];
        commitTarget.splice(-1, 1, body.final);
        commitTarget.push("");
        renderTheirs(this.socketId, this.room);
        break;
      case "keyPress":
        const pressTarget = this.room.messages[body.source];
        if (body.key === "Backspace") {
          pressTarget.splice(-1, 1, pressTarget.slice(-1)[0].slice(0, -1));
        } else {
          pressTarget.splice(-1, 1, pressTarget.slice(-1)[0] + body.key);
        }
        renderTheirLast(pressTarget.slice(-1));
        break;
    }
  };

  clipboard = (type, rawMessage) => {
    this.clipped = true;
    renderHeaders(this.room);
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
window.addEventListener("resize", () => renderHeaders(window.app.room));
function renderError() {
  document.querySelector("#main *").remove();
  document.querySelector("#main").appendChild(
    cre(
      "div.error",
      "Sorry, there are already 2 people in this room. press back or change the url pathname to start a new chat",
    ),
  );
}
function renderMyLast(message) {
  document.querySelector("#mine ul li:last-of-type").innerText = message;
}
function renderTheirLast(message) {
  document.querySelector("#theirs ul li:last-of-type").innerText = message;
}
function renderMine(socketID, room) {
  const myMessages = room.messages[socketID];
  let myMessagesDom;
  if (myMessages) {
    myMessagesDom = cre(
      "ul",
      myMessages.map((message, idx) =>
        cre(`li${idx === myMessages.length - 1 ? ".cursor" : ""}`, message)
      ),
    );
  } else {
    myMessagesDom = cre("ul", cre("li.cursor"));
  }
  document.querySelector("#mine ul")?.remove();
  document.querySelector("#mine").appendChild(myMessagesDom);
}

function renderTheirs(socketId, room) {
  const theirMessages = room.theirId
    ? room.messages[room.theirId]
    : Object.keys(room.messages).filter((id) => socketId !== id).reduce(
      (acc, id) => (acc.concat(room.messages[id])),
      [],
    );
  if (theirMessages) {
    const theirMessagesDom = cre(
      "ul",
      theirMessages.map((message) => cre("li", message)),
    );
    document.querySelector("#theirs ul")?.remove();
    document.querySelector("#theirs").appendChild(
      theirMessagesDom,
    );
  }
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

function renderHeaders(room) {
  const topMessage = room.participants > 1
    ? `talkto.me 2 | issues: https://github.com/jabyrd3/typeto.me2/issues`
    : window.app.clipped
      ? `talkto.me 2 | chat link copied to your clipboard, give it to someone to start a chat`
      : `talkto.me 2 | give someone this url to chat: ${window.location.href}`;
  const bottomMessage = room.participants > 1
    ? `YOU${window.location.pathname}`
    : "Waiting for your party to respond...";
  const paddedTopMessage = padString(topMessage, room.participants < 2)
    .replace(
      "talkto.me 2",
      `<a target="_blank" href="https://github.com/jabyrd3/typeto.me2">talkto.me 2${ghIconModule}</a>`,
    );
  const paddedBottomMessage = padString(bottomMessage);
  document.querySelector("#theirs-header").innerHTML = `<span ${room.participants < 2 ? 'class="pulsate"' : ""
    }>${paddedTopMessage}</span>`;
  document.querySelector("#mine-header").innerHTML =
    `<span>${paddedBottomMessage}</span>`;
  const copyableLinks = document.querySelectorAll(".copyable");
  for (let i = 0; i < copyableLinks.length; i++) {
    const link = copyableLinks[i];
    link.addEventListener("click", (e) => {
      e.preventDefault();
      window.app.clipboard("text/plain", e.srcElement.href);
    });
  }
}

function fullRender(socketID, room) {
  renderHeaders(room);
  renderTheirs(socketID, room);
  renderMine(socketID, room);
}
