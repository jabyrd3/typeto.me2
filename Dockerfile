FROM rust:alpine AS builder

WORKDIR /app
RUN apk update && apk add musl-dev
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM alpine:3.18

RUN apk update && apk add libgcc \
  && rm -rf /var/cache/apk/* \
  && rm -rf /lib/apk/db/* \
  && rm -rf /etc/profile.d/README \
  && rm -rf /usr/bin/c_rehash

COPY --from=builder /app/target/release/typeto-server /app
COPY gui /gui

ENTRYPOINT ["/app"]