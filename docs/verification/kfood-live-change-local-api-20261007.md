# KFood driver live-change HTTP verification

Issue: EVNSolution/clever-routes-app#296. Change control: EVNSolution/clever-change-control#314.

## Scope and command

This check connects the actual Shopify BFF, server Fastify routes and Prisma repositories, and mobile API clients, live-change controller, persistent domain store and offline queue. It uses a temporary PostgreSQL 17 cluster on loopback. All customer, route, driver, proof and token data are synthetic. External push, geocoding and payment providers are disabled.

```sh
node scripts/verify-kfood-live-change-local-api.mjs \
  /path/to/clever-route-server-pr486 \
  /path/to/clever-shopify-app-pr328 \
  /opt/homebrew/opt/postgresql@17/bin
```

The check requires the server dependencies and generated Prisma client in its supplied checkout. It does not load `.env`. It creates and migrates its own database, then closes Fastify and Prisma, stops PostgreSQL and removes temporary database/state files in `finally`.

The sanitized [result JSON](kfood-live-change-local-api-20261007.json) records the exact server and Shopify commits, mobile base commit and SHA-256 digest of the mobile source tree. The source digest covers uncommitted implementation files. The base commit alone is not a claim that the implementation exists in that commit.

## Verified scenarios

1. Office Save creates a private draft. Mobile assigned-route and publication GET retain baseline data.
2. Dispatch creates pending state. The mobile refresh controller preserves locally applied addresses and order. A device without a saved baseline gets an explicit recovery gate.
3. Apply captures immutable publication N. Publication N+1 dispatched during ACK remains pending. The applied addresses stay at N.
4. Apply persists the route, proof drafts and exact ACK identity before acknowledgement. A lost response after server commit survives a new store instance and retries the same ACK.
5. Account and assignment-generation keys prevent another account or generation from reading saved state.
6. The actual offline queue submits stop 2 completion from the original publication. The server accepts unchanged target evidence. The client event ID, version, generation, timestamp and payload remain unchanged.
7. The actual server rejects changed stop 7 and reordered-target evidence. The queue retains the original evidence in quarantine.
8. Non-enrolled queue behavior and route-level events still require exact versions. The queue blocks wrong generations. The server also rejects a wrong-generation ACK.
9. Execution refresh advances completion status while retaining the applied operational content.
10. A later explicit Apply adopts the future stop order, clears pending and preserves completion, proof drafts, items and monetary fields.

## Limits

This is a real local HTTP and database integration check. It does not render React Native UI or prove physical-device behavior. Persistence uses the production domain store with an atomic temporary-file adapter. Native SQLCipher, SecureStore, OS background lifecycle, notification delivery and authenticated Shopify embedding still require device/store acceptance. No production data was changed. No merge, deployment or app-store publication occurred.
