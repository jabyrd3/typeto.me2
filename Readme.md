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

```bash
DOCKER_BUILDKIT=1 docker build --target binaries --output bin -f builder.dockerfile .
```

then you can run it like: ./bin/type from the root of this repo. it needs the
files in ./gui to work

## build and run as docker container

note: rooms.json is used to persist chat history/room state. rooms are deleted
entirely from memory and disk after 12 hours with no sockets connected

```bash
touch rooms.json   # prevent Docker from creating a directory if not present
docker compose up -d
```

## dev

install deno like this:

```bash
curl -fsSL https://deno.land/x/install/install.sh | sh -s v1.9.2
```

then

```
deno run --allow-read --allow-write --watch -A --no-check server/index.ts
```

if you change the gui code you need to refresh the browser tab

but it gives you live-dev with the ts type checking off for the backend code.

## proxying with apache2

Here is an example SSL reverse proxy configuration:

```apache
<VirtualHost *:443>
    ServerName typeto.me

    ProxyPass "/ws" "ws://127.0.0.1:8090/ws"
    ProxyPassReverse "/ws" "ws://127.0.0.1:8090/ws"
    ProxyPass "/"  "http://127.0.0.1:8090/"
    ProxyPassReverse  "/" "http://127.0.0.1:8090/"

    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile /etc/letsencrypt/live/typeto.me/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/typeto.me/privkey.pem
</VirtualHost>
```

Here is how to do it in Caddy, which should convince you that you should be using Caddy:

```
typeto.me {	reverse_proxy localhost:8090 }
```

# credits

[Jordan Byrd](https://jordanbyrd.com/) (main contributor)

[Daniel Drucker](https://3e.org/dmd/)
