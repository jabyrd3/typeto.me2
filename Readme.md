# typeto.me 2

typeto.me 2 is a character-level realtime chat, like the old
[talk program](https://en.wikipedia.org/wiki/Talk_(software)) on Unix and
Unix-like operating systems.

This is a rewrite of
[an earlier version by Derek Arnold](https://github.com/lysol/typeto.me).

- some nostalgic crt bling.
- built with deno, cre, and a font.
- no other deps required

[try it out!](https://typeto.me)

## building as a binary

```
DOCKER_BUILDKIT=1 docker build --target binaries --output bin -f builder.dockerfile .
```

then you can run it like: ./bin/type from the root of this repo. it needs the
files in ./gui to work

## build and run as docker container

note: rooms.json is used to persist chat history/room state. rooms are deleted
entirely from memory and disk after 12 hours with no sockets connected

```
DOCKER_BUILDKIT=1 docker build --tag deno-build:latest -f builder.dockerfile .
docker build -t type2:latest .
touch rooms.json
docker run --init -d -v ./rooms.json:/rooms.json -p 8089:8089 -p 8090:8090 --restart unless-stopped type2:latest
```

## dev

install deno like this:

```
curl -fsSL https://deno.land/x/install/install.sh | sh -s v1.9.2
```

then

```
deno run --allow-read --allow-write --watch -A --no-check server/index.mjs
```

if you change the gui code you need to refresh the browser tab

but it gives you live-dev with the ts type checking off for the backend code.

# networking, ports, proxies, etc

the browser needs to establish a websocket connection to the backend for this to
function. in order to keep this as-simple as possible, the browser figures out
how to do that based on a few rules:

- if the url of the page contains https, it will attempt to use the wss://
  protocol, which requires a reverse proxy with valid tls certs
- if the url of the page doesn't include an explicit port, it will use 81 or 444
  as the defaults for ws:// or wss:// respectively
- if the url of the page does contain an explicit port, it will attempt to
  connect to that port + 1 regardless of the protocol

## proxying with apache2

Here is an example SSL reverse proxy configuration:

```
<VirtualHost *:443>
    ServerName typeto.me
    ProxyPass / http://127.0.0.1:8089/ Keepalive=On
    ProxyPassReverse / http://127.0.0.1:8089/
    SSLCertificateFile /etc/letsencrypt/live/typeto.me/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/typeto.me/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
<VirtualHost *:444>
    ServerName typeto.me
    ProxyPass / ws://127.0.0.1:8090/ Keepalive=On
    ProxyPassReverse / ws://127.0.0.1:8090/
    SSLCertificateFile /etc/letsencrypt/live/typeto.me/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/typeto.me/privkey.pem
    Include /etc/letsencrypt/options-ssl-apache.conf
</VirtualHost>
```

# credits

[Jordan Byrd](https://jordanbyrd.com/) did all the work;
[Daniel](https://3e.org/dmd/) nagged him to do it.
