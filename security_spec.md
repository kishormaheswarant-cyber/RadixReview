# Radix Cloud Firestore Security Specification

## 1. Data Invariants
1. **Identity Integrity**: Every user-owned document (`users`, `private`, `paymentMethods`, `sellers`, `products`, `reviews`, `externalOffers`, `orders`) must bind its owner/author UID (`userId`, `ownerId`, `buyerId`, `actorId`) strictly to `request.auth.uid` with `email_verified == true`.
2. **PII Isolation (Split Collection)**: Private user PII (`email`, shipping address, phone) lives exclusively under `/users/{userId}/private/info` and tokenized cards under `/users/{userId}/paymentMethods/{methodId}`; reads and writes are restricted solely to `request.auth.uid == userId`.
3. **Zero Privilege / Verification Spoofing**: Users cannot self-assign `verified: true` on `/sellers/{sellerId}` or `verifiedPurchase: true` without matching ownership rules; no `admin` or `role` privilege escalation fields exist.
4. **Master Gate & Subcollection Sync**: `/orders/{orderId}/items/{itemId}` and `/orders/{orderId}/trackingEvents/{eventId}` validate the parent `/orders/{orderId}` via `get()` on single-document operations and enforce `buyerId` / `sellerIds` membership.
5. **Terminal State Locking & Sequential Transitions**: Once an order reaches `status == 'delivered'`, no further updates are permitted. Sellers listed in `existing().sellerIds` may only advance `status` sequentially (`confirmed` -> `packed` -> `dispatched` -> `out_for_delivery` -> `delivered`).
6. **Temporal Integrity & Immutability**: `createdAt`, `joinedAt`, and `updatedAt` must equal `request.time` on creation/update, and creator timestamps / owner IDs remain immutable on updates.
7. **Strict Keys & Boundary Limits**: Every write uses `hasAll`/`hasOnly` on create, `affectedKeys().hasOnly(...)` on update, bounded strings/integers, regex-guarded IDs (`^[a-zA-Z0-9_\\-]+$`), and bounded arrays (`specs.size() <= 12`, `sellerIds.size() <= 10`).

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Identity Spoofing on Product**: Authenticated user `uid_attacker` creates `/products/prd_fake` with `ownerId: "uid_victim"`. -> Expected: `PERMISSION_DENIED`.
2. **Ghost / Shadow Field Injection on Seller**: Authenticated user creates `/sellers/sel_1` including an extra field `adminOverride: true` or `verified: true`. -> Expected: `PERMISSION_DENIED`.
3. **PII Blanket Read Violation**: Authenticated user `uid_other` requests `get` on `/users/uid_victim/private/info` or `/users/uid_victim/paymentMethods/pm_1`. -> Expected: `PERMISSION_DENIED`.
4. **ID Poisoning (1KB ID)**: Authenticated user attempts to create `/reviews/${'x'.repeat(500)}` or ID containing slashes/spaces. -> Expected: `PERMISSION_DENIED`.
5. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create a review or order. -> Expected: `PERMISSION_DENIED`.
6. **Temporal Forgery**: Authenticated user creates `/reviews/rev_1` with a backdated `createdAt` not equal to `request.time`. -> Expected: `PERMISSION_DENIED`.
7. **Immutable Owner Mutation**: Product owner attempts to update `ownerId` or `createdAt` on `/products/prd_1`. -> Expected: `PERMISSION_DENIED`.
8. **State Shortcutting on Order**: Seller attempts to jump order `status` directly from `confirmed` to `delivered`, skipping `packed`, `dispatched`, `out_for_delivery`. -> Expected: `PERMISSION_DENIED`.
9. **Terminal State Bypass on Order**: Seller attempts to mutate `status` back to `dispatched` after order reached `delivered`. -> Expected: `PERMISSION_DENIED`.
10. **Unauthorized Order Fulfillment**: Random signed-in user (not in `order.sellerIds`) attempts to advance order status or append a tracking event under `/orders/ord_1/trackingEvents/evt_1`. -> Expected: `PERMISSION_DENIED`.
11. **Array Poisoning on Product Specs / SellerIds**: User creates `/products/prd_1` with `specs` containing 25 elements (`> 12`) or `specs[0]` as a string instead of a map, or an order with `sellerIds[0]` as an integer. -> Expected: `PERMISSION_DENIED`.
12. **Unauthorized Order List Query**: Signed-in user runs a broad `list` query on `/orders` without filtering to `buyerId == request.auth.uid` or `sellerIds array-contains request.auth.uid`. -> Expected: `PERMISSION_DENIED`.
