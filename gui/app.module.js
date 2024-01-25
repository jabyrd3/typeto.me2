import cre from 'https://unpkg.com/cre@0.3.0/cre.js';
console.log("hey there pardner 🤠");
const nonEvents = ['Shift', "Meta", "Control", "Alt", "Enter", "Escape", "Backspace"]

class App {
  constructor() {
    this.socketId = localStorage.getItem('socketId');
    this.setup();
    this.connected = false;
    this.clipped = false;
    window.clippy = this.clipboard;
    setInterval(() => {
      if (this.ws.readyState !== 1) {
        this.connected = false;
        this.teardown();
        this.setup();
        console.log('interval caught dead socket')
      }
    }, 5000)
  }
  setup = () => {
    if (!this.connected) {
      this.connected = true;
      console.log('connecting...')
      this.socketId = localStorage.getItem('socketId');
      const proto = window.location.protocol.includes('s') ? 'wss://' : 'ws://';
      const domain = window.location.hostname;
      const port = window.location.port.length > 0 ?
        parseInt(window.location.port) + 1 :
        proto === 'wss://' ? 444 : 81;
      this.ws = new WebSocket(`${proto}${domain}:${port}`);
      this.ws.addEventListener("open", this.rootHandler);
      this.ws.addEventListener("message", this.messageHandler);
      this.ws.json = (obj) => {
        this.ws.send(JSON.stringify({
          ...obj,
          socketId: this.socketId
        }))
      }
      window.addEventListener("keydown", this.keydownHandler);
      this.pasteListener = document.addEventListener("paste", evt => {
        var clipboardData = evt.clipboardData || window.clipboardData;
        var pastedText = clipboardData.getData("text/plain");
        pastedText.split('').map(char => this.ws.json({
          type: 'keyPress',
          key: char
        }))
        this.room.messages[this.socketId].splice(-1, 1, this.room.messages[this.socketId].slice(-1)[0] + pastedText)
        renderMine(this.socketId, this.room)
      });

    }
  }
  keydownHandler = (evt) => {
    const {
      key
    } = evt;
    if (!evt.metaKey && !evt.ctrlKey) {
      const target = this.room.messages[this.socketId];
      this.ws.json({
        type: 'keyPress',
        key
      })
      if (key !== 'Enter') {
        if (key === 'Space') {
          this.room.messages[this.socketId].splice(-1, 1, this.room.messages[this.socketId].slice(-1)[0] + ' ')
        }
        if (key === 'Backspace') {
          this.room.messages[this.socketId].splice(-1, 1, this.room.messages[this.socketId].slice(-1)[0].slice(0, -1))
        }
        if (!nonEvents.includes(key)) {
          this.room.messages[this.socketId].splice(-1, 1, this.room.messages[this.socketId].slice(-1)[0] + key)
        }
      } else {
        this.room.messages[this.socketId].push('')
      }
      renderMine(this.socketId, this.room)
    }
  }
  teardown = () => {
    console.log('teardown hit, reconecting?');
    try {
      this.ws.close();
    } catch (e) {
      console.log('ws already closed');
    }
    window.removeEventListener("keydown", this.keydownHandler);
    document.removeEventListener("paste", this.pasteListener);
  }
  rootHandler = () => {
    this.connected = true;
    if (window.location.pathname === "/") {
      this.ws.json({
        type: "newroom",
      });
    } else {
      this.ws.json({
        type: 'fetchRoom',
        id: window.location.pathname.replace('/', '')
      })
    }
  };
  messageHandler = (raw) => {
    const body = JSON.parse(raw.data);
    if (body?.room?.yourId) {
      this.socketId = body.room.yourId
      localStorage.setItem('socketId', this.socketId)
    }
    switch (body.type) {
      case "room-is-crowded":
        renderError();
      break;
      case "roomCreated":
        window.history.pushState("chatpage", `Chat ${body.room.id}`, `/${body.room.id}`);
        this.room = body.room;
        fullRender(this.socketId, this.room)
        break;
      case "gotRoom":
        if(window.location.pathname === '/'){
          window.history.pushState("chatpage", `Chat ${body.room.id}`, `/${body.room.id}`);
        }
        this.room = body.room;
        fullRender(this.socketId, this.room)
        break;
      case "committed":
        const slice = this.room.messages[body.source]
        const sl = slice.length
        slice[sl - 1] = body.final
        slice.push('')
        renderTheirs(this.socketId, this.room)
        break;
      case "keyPress":
        const target = this.room.messages[body.source]
        // const len = target.length
        // target[len - 1] += body.key
        if (body.key === 'Backspace') {
          target.splice(-1, 1, target.slice(-1)[0].slice(0, -1))
        } else {
          target.splice(-1, 1, target.slice(-1)[0] + body.key)
        }
        // this.room.messages[body.source].splice(-1, 1, this.room.messages)
        renderTheirs(this.socketId, this.room)
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
  }
}
const app = await new App();
window.app = app;
window.addEventListener('resize', () => renderHeaders(window.app.room));
function renderError(){
  document.querySelector('#main *').remove()
  document.querySelector('#main').appendChild(cre('div.error', 'Sorry, there are already 2 people in this room. press back or change the url pathname to start a new chat'));
}
function renderMine(socketID, room) {
  const myMessages = room.messages[socketID]
  let myMessagesDom;
  if (myMessages) {
    myMessagesDom = cre('ul', myMessages.map((message, idx) => cre(`li${idx === myMessages.length - 1 ? '.cursor' : ''}`, message)));
  } else {
    myMessagesDom = cre('ul', cre('li.cursor'));
  }
  document.querySelector('#mine ul')?.remove()
  document.querySelector('#mine').appendChild(iterateAndLinkNodeList(myMessagesDom));
}
function iterateAndLinkNodeList(nl){
  for (let i = 0; i < nl.childNodes.length; i++) {
    const node = nl.childNodes[i];
    node.innerHTML = linkify(node.innerText)
  }
  return nl;
}
function renderTheirs(socketId, room) {
  // const theirMessages = room.messages[Object.keys(room.messages).find(id => id !== socketID)]
  const theirMessages = Object.keys(room.messages).filter(id => socketId !== id).reduce((acc, id) => (acc.concat(room.messages[id])), [])
  if (theirMessages) {
    const theirMessagesDom = cre('ul', theirMessages.map(message => cre('li', linkify(message))))
    document.querySelector('#theirs ul')?.remove()
    document.querySelector('#theirs').appendChild(iterateAndLinkNodeList(theirMessagesDom));
  }
}
// if the regex is shit blame gpt, i can't be assed to do this cleaner at the moment
function linkify(inputText, copy) {
  const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])/ig;
  return inputText.replace(urlRegex, function(url) {
    return `<a href="${url}" ${copy ? 'class="copyable"' : ''}>${url}</a>`;
  });
}


function padString(string, clip) {
  const widthInHyphens = window.innerWidth / 8;
  const padding = widthInHyphens - string.length - 4;
  const hyphens = Array.from({
    length: Math.floor(padding / 2)
  }).map(() => "-").join('')
  return `${hyphens}= <span class="message">${linkify(string, clip)}</span> =${hyphens}`
}

function renderHeaders(room) {
  const topMessage = window.app.clipped ? 
    `talkto.me 2 | chat link copied to your clipboard, give it to someone to start a chat` :
    `talkto.me 2 | give someone this url to chat: ${window.location.href}`;
  const bottomMessage = room.participants > 1 ? `YOU ${window.location.pathname}` : 'Waiting for your party to respond...';
  const paddedTopMessage = padString(topMessage, true)
  const paddedBottomMessage = padString(bottomMessage)
  document.querySelector('#theirs-header').innerHTML = `<span ${room.participants < 2 ? 'class="pulsate"' : ''}>${paddedTopMessage}</span>`
  document.querySelector('#mine-header').innerHTML = `<span>${paddedBottomMessage}</span>`
  const copyableLinks = document.querySelectorAll('.copyable');
  for (let i = 0; i < copyableLinks.length; i++) {
    const link = copyableLinks[i];
    link.addEventListener('click', e=>{
      e.preventDefault();
      window.app.clipboard('text/plain', e.srcElement.href);
    })
  }
}

function fullRender(socketID, room) {
  renderHeaders(room);
  renderTheirs(socketID, room)
  renderMine(socketID, room)
}
