FROM rust:alpine as builder
WORKDIR /app
RUN apk update && apk add musl-dev upx
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release
RUN upx /app/target/release/typeto-server

FROM scratch AS binaries
COPY --from=builder /app/target/release/typeto-server /