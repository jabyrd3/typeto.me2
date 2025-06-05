# typeto.me 2

typeto.me 2 is a character-level realtime chat, like the old
[talk program](https://en.wikipedia.org/wiki/Talk_(software)) on Unix and
Unix-like operating systems.

This is a rewrite of
[an earlier version by Derek Arnold](https://github.com/lysol/typeto.me).

- some nostalgic crt bling.
- built with rust
- no other deps required

[try it out!](https://typeto.me)

## legacy deno version

The original Deno version is available in the `legacy-deno` branch.


## building as a binary

```bash
DOCKER_BUILDKIT=1 docker build --target binaries --output bin -f builder.dockerfile .
```

then you can run it like: ./bin/typeto-server from the root of this repo. it needs the files in ./gui to work

## build and run as docker container

note: rooms are stored in memory and deleted after 12 hours with no sockets connected

```bash
docker compose up -d
```

## dev

For development with the Rust server:

```bash
cargo run
```

# credits

[Jordan Byrd](https://jordanbyrd.com/) (main contributor)

[Daniel Drucker](https://3e.org/dmd/)

Warning: Multi (3+) user support, mobile support, the curses TUI, and the entire port to Rust were entirely vibe-coded and no human has ever reviewed or even looked at that code.
