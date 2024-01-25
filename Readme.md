# this is a deno rewrite of typeto.me
emulates 

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
