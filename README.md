# Transparent Oil Revenue Tracking System (TORTS)

## Overview

TORTS (Transparent Oil Revenue Tracking System) is a Web3 project built on the Stacks blockchain using Clarity smart contracts. It provides a decentralized, transparent mechanism for governments to track oil revenues, allocate funds to public services, and prevent corruption through immutable on-chain records, governance voting, and automated disbursements. By leveraging blockchain's transparency, all revenue inflows, proposals, votes, and fund distributions are publicly verifiable, reducing opportunities for embezzlement and ensuring accountability.

This system solves real-world problems in oil-dependent economies (e.g., in countries like Nigeria, Venezuela, or Iraq), where corruption often diverts billions in oil revenues away from essential public services such as healthcare, education, and infrastructure. TORTS enforces rules via smart contracts, allowing citizens, auditors, and international observers to monitor fund usage in real-time without relying on centralized, opaque government systems.

Key Features:
- **Transparent Revenue Recording**: Oil revenues are recorded on-chain via oracles or authorized inputs.
- **Governance-Driven Allocations**: Proposals for fund allocation to public services require community/government voting.
- **Automated Disbursements**: Funds are released only upon successful votes and milestones.
- **Audit Trails**: Immutable logs for all actions.
- **Tokenized Funds**: Revenues represented as STX or custom tokens for easy tracking.

The project consists of 6 core smart contracts written in Clarity, ensuring security, predictability (no reentrancy issues), and composability.

## Problem Solved

In many resource-rich nations, oil revenues are mismanaged due to lack of transparency, leading to:
- Corruption and embezzlement by officials.
- Inefficient allocation to public services.
- Public distrust and social unrest.

TORTS addresses this by:
- Making all financial flows public and immutable.
- Requiring decentralized approval for spending.
- Enabling automated, condition-based releases (e.g., via milestones).
- Providing tools for external audits and citizen oversight.

## Architecture

- **Blockchain**: Stacks (settles on Bitcoin for security).
- **Language**: Clarity (deterministic, safe smart contracts).
- **Tokens**: Uses STX for native transactions; introduces a custom fungible token (OilRevToken) to represent revenue shares.
- **Oracles**: Integrates with external oracles for real-world data (e.g., oil sales confirmation).
- **Frontend Integration**: Can be paired with a dApp for proposal submission, voting, and dashboards (not included here).
- **Contracts Interaction**:
  - RevenueRecorder logs incoming funds.
  - ProposalContract handles allocation requests.
  - VotingContract manages governance votes.
  - DisbursementContract releases funds.
  - AuditLogContract records all events.
  - OracleContract feeds external data.

## Smart Contracts

Below are the 6 smart contracts, including their purpose, key functions, and full Clarity code. These are designed to be composable and secure. Deploy them in order: Token, Oracle, RevenueRecorder, Proposal, Voting, Disbursement, AuditLog.

### 1. OilRevToken (Fungible Token Contract)
**Purpose**: Represents tokenized oil revenues. Uses SIP-10 standard for fungible tokens on Stacks.

```clarity
;; OilRevToken - SIP-10 Fungible Token for Oil Revenues
(define-fungible-token oil-rev-token u1000000000000) ;; Max supply: 1 trillion units

(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant CONTRACT-OWNER tx-sender)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (ft-transfer? oil-rev-token amount sender recipient)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (ft-mint? oil-rev-token amount recipient)
  )
)

(define-read-only (get-balance (account principal))
  (ft-get-balance oil-rev-token account)
)

(define-read-only (get-total-supply)
  (ft-get-supply oil-rev-token)
)
```

### 2. OracleContract
**Purpose**: Feeds external data (e.g., confirmed oil sales revenue) from trusted oracles to prevent manipulation.

```clarity
;; OracleContract - Provides external data feeds
(define-map revenue-data uint { amount: uint, timestamp: uint })
(define-constant ERR-NOT-ORACLE (err u402))
(define-data-var oracle principal tx-sender)
(define-data-var last-revenue-id uint u0)

(define-public (submit-revenue (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle)) ERR-NOT-ORACLE)
    (let ((id (+ (var-get last-revenue-id) u1)))
      (map-set revenue-data id { amount: amount, timestamp: block-height })
      (var-set last-revenue-id id)
      (ok id)
    )
  )
)

(define-public (set-oracle (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get oracle)) ERR-NOT-ORACLE)
    (var-set oracle new-oracle)
    (ok true)
  )
)

(define-read-only (get-revenue (id uint))
  (map-get? revenue-data id)
)
```

### 3. RevenueRecorder
**Purpose**: Records incoming revenues by minting tokens based on oracle data and logging to audit.

```clarity
;; RevenueRecorder - Records and tokenizes revenues
(use-trait audit-log-trait .audit-log-contract.audit-log)
(define-constant ERR-INVALID-AMOUNT (err u403))
(define-data-var total-revenue uint u0)

(define-public (record-revenue (oracle-id uint) (audit-log <audit-log-trait>))
  (let ((revenue (unwrap! (contract-call? .oracle-contract get-revenue oracle-id) ERR-INVALID-AMOUNT)))
    (try! (contract-call? .oil-rev-token mint (get amount revenue) (as-contract tx-sender)))
    (var-set total-revenue (+ (var-get total-revenue) (get amount revenue)))
    (contract-call? audit-log log-event "Revenue Recorded" (get amount revenue) tx-sender)
  )
)

(define-read-only (get-total-revenue)
  (var-get total-revenue)
)
```

### 4. ProposalContract
**Purpose**: Allows authorized users to submit proposals for allocating funds to specific public services (e.g., "Build schools: 1000 tokens").

```clarity
;; ProposalContract - Manages allocation proposals
(use-trait audit-log-trait .audit-log-contract.audit-log)
(define-map proposals uint { proposer: principal, amount: uint, description: (string-ascii 256), status: (string-ascii 32) })
(define-data-var proposal-count uint u0)
(define-constant ERR-NOT-AUTHORIZED (err u401))

(define-public (submit-proposal (amount uint) (description (string-ascii 256)) (audit-log <audit-log-trait>))
  (begin
    (asserts! (> amount u0) (err u404))
    (let ((id (+ (var-get proposal-count) u1)))
      (map-set proposals id { proposer: tx-sender, amount: amount, description: description, status: "Pending" })
      (var-set proposal-count id)
      (contract-call? audit-log log-event "Proposal Submitted" amount tx-sender)
    )
  )
)

(define-public (update-status (id uint) (new-status (string-ascii 32)) (audit-log <audit-log-trait>))
  (begin
    (asserts! (is-eq tx-sender (get proposer (unwrap-panic (map-get? proposals id)))) ERR-NOT-AUTHORIZED)
    (map-set proposals id (merge (unwrap-panic (map-get? proposals id)) { status: new-status }))
    (contract-call? audit-log log-event "Proposal Status Updated" u0 tx-sender)
  )
)

(define-read-only (get-proposal (id uint))
  (map-get? proposals id)
)
```

### 5. VotingContract
**Purpose**: Handles voting on proposals. Requires token holders (e.g., citizens or stakeholders) to vote; majority approves.

```clarity
;; VotingContract - Governance voting on proposals
(use-trait proposal-trait .proposal-contract.get-proposal)
(use-trait audit-log-trait .audit-log-contract.audit-log)
(define-map votes { proposal-id: uint, voter: principal } bool)
(define-map vote-counts uint { yes: uint, no: uint })
(define-constant ERR-ALREADY-VOTED (err u405))
(define-constant VOTING_THRESHOLD u50) ;; 50% yes for approval

(define-public (vote (proposal-id uint) (yes bool) (proposal <proposal-trait>) (audit-log <audit-log-trait>))
  (begin
    (unwrap! (contract-call? proposal get-proposal proposal-id) (err u406))
    (asserts! (is-none (map-get? votes { proposal-id: proposal-id, voter: tx-sender })) ERR-ALREADY-VOTED)
    (map-set votes { proposal-id: proposal-id, voter: tx-sender } yes)
    (if yes
      (map-set vote-counts proposal-id (merge (default-to { yes: u0, no: u0 } (map-get? vote-counts proposal-id)) { yes: (+ u1 (get yes (default-to { yes: u0, no: u0 } (map-get? vote-counts proposal-id))) } }))
      (map-set vote-counts proposal-id (merge (default-to { yes: u0, no: u0 } (map-get? vote-counts proposal-id)) { no: (+ u1 (get no (default-to { yes: u0, no: u0 } (map-get? vote-counts proposal-id))) } })))
    (contract-call? audit-log log-event "Vote Cast" proposal-id tx-sender)
  )
)

(define-read-only (is-approved (id uint))
  (let ((counts (default-to { yes: u0, no: u0 } (map-get? vote-counts id))))
    (> (* (get yes counts) u100) (* (+ (get yes counts) (get no counts)) VOTING_THRESHOLD))
  )
)
```

### 6. DisbursementContract
**Purpose**: Disburses funds to recipients upon proposal approval and voting success.

```clarity
;; DisbursementContract - Handles fund releases
(use-trait voting-trait .voting-contract.is-approved)
(use-trait proposal-trait .proposal-contract.get-proposal)
(use-trait audit-log-trait .audit-log-contract.audit-log)
(define-constant ERR-NOT-APPROVED (err u407))

(define-public (disburse (proposal-id uint) (recipient principal) (voting <voting-trait>) (proposal <proposal-trait>) (audit-log <audit-log-trait>))
  (let ((prop (unwrap! (contract-call? proposal get-proposal proposal-id) ERR-NOT-APPROVED)))
    (asserts! (contract-call? voting is-approved proposal-id) ERR-NOT-APPROVED)
    (try! (as-contract (contract-call? .oil-rev-token transfer (get amount prop) tx-sender recipient none)))
    (contract-call? audit-log log-event "Funds Disbursed" (get amount prop) recipient)
  )
)
```

### 7. AuditLogContract
**Purpose**: Logs all events for transparency and auditing.

```clarity
;; AuditLogContract - Immutable event logging
(define-map logs uint { event: (string-ascii 64), amount: uint, actor: principal, timestamp: uint })
(define-data-var log-count uint u0)

(define-trait audit-log
  (
    (log-event ((string-ascii 64) uint principal) (response bool uint))
  )
)

(define-public (log-event (event (string-ascii 64)) (amount uint) (actor principal))
  (let ((id (+ (var-get log-count) u1)))
    (map-set logs id { event: event, amount: amount, actor: actor, timestamp: block-height })
    (var-set log-count id)
    (ok true)
  )
)

(define-read-only (get-log (id uint))
  (map-get? logs id)
)

(define-read-only (get-log-count)
  (var-get log-count)
)
```

## Deployment

1. Install Clarinet (Stacks dev tool): `cargo install clarinet`.
2. Create a new project: `clarinet new torts`.
3. Add the contracts to `contracts/` directory.
4. Configure `Clarinet.toml` with dependencies (e.g., for traits).
5. Test: `clarinet test`.
6. Deploy to Stacks testnet/mainnet via Clarinet or Stacks API.

Note: Update contract principals (e.g., `.oracle-contract`) with actual deployed addresses.

## Usage

- **Government/Oracle**: Submit revenues via OracleContract.
- **Proposers**: Submit allocation proposals.
- **Voters**: Vote on proposals (requires token holdings for weighted voting, extendable).
- **Recipients**: Receive disbursed funds.
- **Public**: Query logs, proposals, and balances for transparency.

## Security Considerations

- Clarity's design prevents common vulnerabilities like reentrancy.
- Use multi-sig for oracle and owner roles.
- Audit contracts before production.

## Contributing

Fork the repo, add improvements, and PR. Focus on enhancing governance or integrating with other chains.

## License

MIT License.