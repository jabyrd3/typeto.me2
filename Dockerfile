FROM deno-build:latest AS builder
FROM frolvlad/alpine-glibc:alpine-3.11_glibc-2.31
RUN apk update && apk add libstdc++ \
  && rm -rf /var/cache/apk/* \
  && rm -rf /lib/apk/db/* \
  && rm -rf /etc/profile.d/README \
  && rm -rf /usr/bin/c_rehash
COPY --from=builder /app/app /app
COPY entrypoint /usr/bin/entrypoint
ENTRYPOINT ["/usr/bin/entrypoint"]
