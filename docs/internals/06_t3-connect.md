# T3 Connect (removed)

Upstream T3 Code ships T3 Connect: Clerk accounts, a relay Worker, and Cloudflare tunnels run under
T3's account. TLS ended at T3's edge, so the tunnel operator could read every request between a
phone and its computer; there was no end-to-end encryption. The relay also collected connection
traces and mobile crash reports and delivered mobile push. This fork removes all of it.

What stays is direct: a client reaches an environment at an address it can open itself (LAN,
Tailscale via `packages/tailscale`, SSH via `packages/ssh`, or the user's own proxy), authorized by a
pairing link, a bearer session, or a DPoP-bound session renewed with the host
([`04_environment-auth.md`](./04_environment-auth.md), [`05_remote.md`](./05_remote.md)).

Constraints that outlive the removal:

- **Persisted state from older builds is tolerated, not migrated.** Saved `RelayConnectionTarget`
  routes are dropped when the connection catalog decodes, and any other unknown route still fails
  so a newer catalog is not overwritten. The `relay:*` auth scopes and the `relay` connection
  method stay in the contracts because existing grants and sessions carry them; they authorize
  nothing. Sessions minted for T3 Connect are revoked when the server starts.
- **Guest links use the owner's own address.** A guest link points at the http(s) origin the
  owner's client reached the server at, and the server refuses a loopback origin, because the
  guest opens it from another network. See [guest links](../user/guest-links.md).
- **Do not reintroduce a hosted path.** `scripts/check-egress.ts` fails on T3 cloud, relay, and
  tracing hosts in shipped source.
