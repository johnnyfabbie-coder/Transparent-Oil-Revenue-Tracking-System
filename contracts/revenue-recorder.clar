(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-REVENUE-ID u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-ORACLE-NOT-SET u103)
(define-constant ERR-TOKEN-MINT-FAILED u104)
(define-constant ERR-REVENUE-ALREADY-RECORDED u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-INSUFFICIENT-BALANCE u107)
(define-constant ERR-AUDIT-LOG-REQUIRED u108)
(define-constant ERR-REVENUE-LOCKED u109)
(define-constant ERR-INVALID-CURRENCY u110)
(define-constant ERR-MAX-SUPPLY-EXCEEDED u111)
(define-constant ERR-INVALID-ORACLE u112)

(define-data-var oracle-principal (optional principal) none)
(define-data-var total-recorded-revenue uint u0)
(define-data-var revenue-nonce uint u0)
(define-data-var max-supply uint u1000000000000)
(define-data-var revenue-lock-period uint u1440)

(define-map recorded-revenues
  uint
  {
    amount: uint,
    currency: (string-ascii 10),
    timestamp: uint,
    oracle-id: uint,
    recorded-by: principal,
    locked-until: uint
  }
)

(define-map oracle-submissions
  { oracle: principal, revenue-id: uint }
  bool
)

(define-fungible-token oil-rev-token)

(define-trait audit-log-trait
  (
    (log-event (string-ascii uint principal) (response bool uint))
  )
)

(define-public (set-oracle (new-oracle principal))
  (let (
    (current-oracle (var-get oracle-principal))
  )
    (asserts! (is-some current-oracle) (err ERR-ORACLE-NOT-SET))
    (asserts! (is-eq (some tx-sender) current-oracle) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-principal (some new-oracle))
    (ok true)
  )
)

(define-public (initialize-oracle (initial-oracle principal))
  (begin
    (asserts! (is-none (var-get oracle-principal)) (err ERR-ORACLE-NOT-SET))
    (asserts! (not (is-eq initial-oracle tx-sender)) (err ERR-INVALID-ORACLE))
    (var-set oracle-principal (some initial-oracle))
    (ok true)
  )
)

(define-public (record-revenue
  (oracle-id uint)
  (amount uint)
  (currency (string-ascii 10))
  (audit-log <audit-log-trait>)
  )
  (let (
    (nonce (var-get revenue-nonce))
    (caller tx-sender)
    (current-oracle (unwrap! (var-get oracle-principal) (err ERR-ORACLE-NOT-SET)))
    (existing-submission (map-get? oracle-submissions { oracle: caller, revenue-id: oracle-id }))
    (block-time block-height)
    (lock-until (+ block-time (var-get revenue-lock-period)))
    (new-total (+ (var-get total-recorded-revenue) amount))
    (max-supply (var-get max-supply))
  )
    (asserts! (is-eq caller current-oracle) (err ERR-NOT-AUTHORIZED))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (or (is-eq currency "USD") (is-eq currency "STX") (is-eq currency "OIL")) (err ERR-INVALID-CURRENCY))
    (asserts! (is-none existing-submission) (err ERR-REVENUE-ALREADY-RECORDED))
    (asserts! (<= new-total max-supply) (err ERR-MAX-SUPPLY-EXCEEDED))
    (try! (contract-call? audit-log log-event amount caller))
    (try! (ft-mint? oil-rev-token amount (as-contract tx-sender)))
    (map-set recorded-revenues nonce
      {
        amount: amount,
        currency: currency,
        timestamp: block-time,
        oracle-id: oracle-id,
        recorded-by: caller,
        locked-until: lock-until
      }
    )
    (map-set oracle-submissions { oracle: caller, revenue-id: oracle-id } true)
    (var-set revenue-nonce (+ nonce u1))
    (var-set total-recorded-revenue new-total)
    (ok nonce)
  )
)

(define-public (release-locked-revenue (revenue-id uint) (recipient principal))
  (let (
    (revenue (unwrap! (map-get? recorded-revenues revenue-id) (err ERR-INVALID-REVENUE-ID)))
    (current-time block-height)
  )
    (asserts! (>= current-time (get locked-until revenue)) (err ERR-REVENUE-LOCKED))
    (asserts! (is-eq tx-sender (get recorded-by revenue)) (err ERR-NOT-AUTHORIZED))
    (try! (as-contract (ft-transfer? oil-rev-token (get amount revenue) tx-sender recipient)))
    (map-delete recorded-revenues revenue-id)
    (ok true)
  )
)

(define-read-only (get-recorded-revenue (id uint))
  (map-get? recorded-revenues id)
)

(define-read-only (get-total-recorded)
  (var-get total-recorded-revenue)
)

(define-read-only (get-oracle)
  (var-get oracle-principal)
)

(define-read-only (is-oracle-submission (oracle principal) (revenue-id uint))
  (map-get? oracle-submissions { oracle: oracle, revenue-id: revenue-id })
)

(define-read-only (get-token-balance (owner principal))
  (ft-get-balance oil-rev-token owner)
)

(define-read-only (get-contract-balance)
  (ft-get-balance oil-rev-token (as-contract tx-sender)))