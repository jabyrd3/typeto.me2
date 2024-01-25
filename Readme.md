# this is a deno rewrite of typeto.me
emulates ytalk with some nostalgic crt bling. built with deno, cre, and a font. no other deps required

## build a binary (shove this in a bare alpine container with an entrypoint if u want)

```
DOCKER_BUILDKIT=1 docker build --target binaries --output bin -f builder.dockerfile .
```

## dev

install deno like this:

```
curl -fsSL https://deno.land/x/install/install.sh | sh -s v1.9.2
```

then

```
deno run --unstable --watch -A --no-check server/index.mjs
```

if you change the gui code you need to refresh the browser tab

but it gives you live-dev with the ts type checking off for the backend code.

# networking, ports, proxies, etc

the browser needs to establish a websocket connection to the backend for this to function. in order to keep this as-simple as possible, the browser figures out how to do that based on a few rules:

- if the url of the page contains https, it will attempt to use the wss:// protocol, which requires a reverse proxy with valid tls certs
- if the url of the page doesn't include an explicit port, it will use 81 or 444 as the defaults for ws:// or wss:// respectively
- if the url of the page does contain an explicit port, it will attempt to connect to that port + 1 regardless of the protocol