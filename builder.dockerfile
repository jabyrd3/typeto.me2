FROM frolvlad/alpine-glibc:alpine-3.11_glibc-2.31 as builder
WORKDIR /app
RUN apk update && apk add curl libstdc++ upx
RUN curl -fsSL https://deno.land/x/install/install.sh | sh -s v1.39.4
COPY server /app
RUN /root/.deno/bin/deno compile -A --no-check --output type index.ts

# can't upx deno binaries, it strips all the business logic. probably figure this out, the binaries are too-fat rn
# RUN upx type

FROM scratch AS binaries
COPY --from=builder /app/type /

