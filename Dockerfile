FROM frolvlad/alpine-glibc:alpine-3.11_glibc-2.31 as builder

WORKDIR /app
RUN apk update && apk add curl libstdc++ upx
RUN curl -fsSL https://deno.land/x/install/install.sh | sh -s v1.39.4
COPY server /app
RUN /root/.deno/bin/deno compile -A --no-check --output type index.ts

FROM frolvlad/alpine-glibc:alpine-3.11_glibc-2.31

RUN apk update && apk add libstdc++ \
  && rm -rf /var/cache/apk/* \
  && rm -rf /lib/apk/db/* \
  && rm -rf /etc/profile.d/README \
  && rm -rf /usr/bin/c_rehash

COPY --from=builder /app/type /app
COPY gui /gui
COPY entrypoint /usr/bin/entrypoint

ENTRYPOINT ["/usr/bin/entrypoint"]
