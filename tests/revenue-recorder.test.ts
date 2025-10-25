import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityType } from "@stacks/transactions";

interface RevenueRecord {
  amount: bigint;
  currency: string;
  timestamp: bigint;
  oracleId: bigint;
  recordedBy: string;
  lockedUntil: bigint;
}

interface Result<T> {
  type: ClarityType;
  value: T;
}

class RevenueRecorderMock {
  state: {
    oracle: string | null;
    totalRecorded: bigint;
    nonce: bigint;
    maxSupply: bigint;
    lockPeriod: bigint;
    revenues: Map<bigint, RevenueRecord>;
    submissions: Map<string, Set<bigint>>;
    balances: Map<string, bigint>;
  } = {
    oracle: null,
    totalRecorded: BigInt(0),
    nonce: BigInt(0),
    maxSupply: BigInt(1_000_000_000_000),
    lockPeriod: BigInt(1440),
    revenues: new Map(),
    submissions: new Map(),
    balances: new Map(),
  };

  blockHeight = BigInt(100);
  caller = "ST1ORACLE";

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      oracle: null,
      totalRecorded: BigInt(0),
      nonce: BigInt(0),
      maxSupply: BigInt(1_000_000_000_000),
      lockPeriod: BigInt(1440),
      revenues: new Map(),
      submissions: new Map(),
      balances: new Map(),
    };
    this.blockHeight = BigInt(100);
    this.caller = "ST1ORACLE";
    const contractAddr = this.getContractAddress();
    this.state.balances.set(contractAddr, BigInt(0));
  }

  getContractAddress(): string {
    return "STRECORDER";
  }

  setOracle(newOracle: string): Result<boolean> {
    if (!this.state.oracle) return { type: ClarityType.UInt, value: BigInt(103) };
    if (this.caller !== this.state.oracle) return { type: ClarityType.UInt, value: BigInt(100) };
    this.state.oracle = newOracle;
    return { type: ClarityType.BoolTrue, value: true };
  }

  initializeOracle(initialOracle: string): Result<boolean> {
    if (this.state.oracle !== null) return { type: ClarityType.UInt, value: BigInt(103) };
    if (initialOracle === this.caller) return { type: ClarityType.UInt, value: BigInt(112) };
    this.state.oracle = initialOracle;
    return { type: ClarityType.BoolTrue, value: true };
  }

  recordRevenue(
    oracleId: bigint,
    amount: bigint,
    currency: string,
    auditLog: any
  ): Result<bigint> {
    if (!this.state.oracle) return { type: ClarityType.UInt, value: BigInt(103) };
    if (this.caller !== this.state.oracle) return { type: ClarityType.UInt, value: BigInt(100) };
    if (amount <= BigInt(0)) return { type: ClarityType.UInt, value: BigInt(102) };
    if (!["USD", "STX", "OIL"].includes(currency)) return { type: ClarityType.UInt, value: BigInt(110) };

    const submissionKey = `${this.caller}-${oracleId}`;
    if (this.state.submissions.has(submissionKey) && this.state.submissions.get(submissionKey)!.has(oracleId)) {
      return { type: ClarityType.UInt, value: BigInt(105) };
    }

    const newTotal = this.state.totalRecorded + amount;
    if (newTotal > this.state.maxSupply) return { type: ClarityType.UInt, value: BigInt(111) };

    const nonce = this.state.nonce;
    const lockUntil = this.blockHeight + this.state.lockPeriod;

    this.state.revenues.set(nonce, {
      amount,
      currency,
      timestamp: this.blockHeight,
      oracleId,
      recordedBy: this.caller,
      lockedUntil: lockUntil,
    });

    const contractAddr = this.getContractAddress();
    const contractBal = this.state.balances.get(contractAddr) || BigInt(0);
    this.state.balances.set(contractAddr, contractBal + amount);

    if (!this.state.submissions.has(submissionKey)) {
      this.state.submissions.set(submissionKey, new Set());
    }
    this.state.submissions.get(submissionKey)!.add(oracleId);

    this.state.nonce += BigInt(1);
    this.state.totalRecorded = newTotal;

    return { type: ClarityType.UInt, value: nonce };
  }

  releaseLockedRevenue(revenueId: bigint, recipient: string): Result<boolean> {
    const revenue = this.state.revenues.get(revenueId);
    if (!revenue) return { type: ClarityType.UInt, value: BigInt(101) };
    if (this.blockHeight < revenue.lockedUntil) return { type: ClarityType.UInt, value: BigInt(109) };
    if (this.caller !== revenue.recordedBy) return { type: ClarityType.UInt, value: BigInt(100) };

    const contractAddr = this.getContractAddress();
    const contractBal = this.state.balances.get(contractAddr)!;
    if (contractBal < revenue.amount) return { type: ClarityType.UInt, value: BigInt(107) };

    this.state.balances.set(contractAddr, contractBal - revenue.amount);
    const recipientBal = this.state.balances.get(recipient) || BigInt(0);
    this.state.balances.set(recipient, recipientBal + revenue.amount);

    this.state.revenues.delete(revenueId);
    return { type: ClarityType.BoolTrue, value: true };
  }

  getRecordedRevenue(id: bigint): RevenueRecord | null {
    return this.state.revenues.get(id) || null;
  }

  getTotalRecorded(): bigint {
    return this.state.totalRecorded;
  }

  getOracle(): string | null {
    return this.state.oracle;
  }

  getTokenBalance(owner: string): bigint {
    return this.state.balances.get(owner) || BigInt(0);
  }
}

describe("RevenueRecorder", () => {
  let mock: RevenueRecorderMock;

  beforeEach(() => {
    mock = new RevenueRecorderMock();
    mock.reset();
  });

  it("initializes oracle successfully", () => {
    mock.caller = "ST1ADMIN";
    const result = mock.initializeOracle("ST1ORACLE");
    expect(result.type).toBe(ClarityType.BoolTrue);
    expect(result.value).toBe(true);
    expect(mock.getOracle()).toBe("ST1ORACLE");
  });

  it("rejects oracle self-initialization", () => {
    mock.caller = "ST1ORACLE";
    const result = mock.initializeOracle("ST1ORACLE");
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(112));
  });

  it("records revenue with valid parameters", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    const result = mock.recordRevenue(BigInt(1000), BigInt(500000), "USD", {});
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(0));

    const revenue = mock.getRecordedRevenue(BigInt(0));
    expect(revenue?.amount).toBe(BigInt(500000));
    expect(revenue?.currency).toBe("USD");
    expect(revenue?.lockedUntil).toBe(mock.blockHeight + BigInt(1440));
    expect(mock.getTotalRecorded()).toBe(BigInt(500000));
  });

  it("rejects recording with zero amount", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    const result = mock.recordRevenue(BigInt(1), BigInt(0), "USD", {});
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(102));
  });

  it("rejects invalid currency", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    const result = mock.recordRevenue(BigInt(1), BigInt(1000), "BTC", {});
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(110));
  });

  it("prevents double submission of same oracle-id", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.recordRevenue(BigInt(1), BigInt(1000), "USD", {});
    const result = mock.recordRevenue(BigInt(1), BigInt(2000), "STX", {});
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(105));
  });

  it("enforces max supply limit", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.state.maxSupply = BigInt(1000);
    const result = mock.recordRevenue(BigInt(1), BigInt(1001), "USD", {});
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(111));
  });

  it("locks revenue for 1440 blocks", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.recordRevenue(BigInt(1), BigInt(1000), "USD", {});
    const revenue = mock.getRecordedRevenue(BigInt(0));
    expect(revenue?.lockedUntil).toBe(mock.blockHeight + BigInt(1440));
  });

  it("releases revenue after lock period", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.recordRevenue(BigInt(1), BigInt(5000), "USD", {});
    mock.blockHeight += BigInt(1441);
    const result = mock.releaseLockedRevenue(BigInt(0), "ST1RECIPIENT");
    expect(result.type).toBe(ClarityType.BoolTrue);
    expect(result.value).toBe(true);

    expect(mock.getTokenBalance("ST1RECIPIENT")).toBe(BigInt(5000));
    expect(mock.getRecordedRevenue(BigInt(0))).toBeNull();
  });

  it("rejects early release", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.recordRevenue(BigInt(1), BigInt(1000), "USD", {});
    mock.blockHeight += BigInt(100);
    const result = mock.releaseLockedRevenue(BigInt(0), "ST1RECIPIENT");
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(109));
  });

  it("rejects release by non-recorder", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.recordRevenue(BigInt(1), BigInt(1000), "USD", {});
    mock.blockHeight += BigInt(2000);
    mock.caller = "ST2HACKER";
    const result = mock.releaseLockedRevenue(BigInt(0), "ST2HACKER");
    expect(result.type).toBe(ClarityType.UInt);
    expect(result.value).toBe(BigInt(100));
  });

  it("allows oracle to change itself", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    const result = mock.setOracle("ST2NEWORACLE");
    expect(result.type).toBe(ClarityType.BoolTrue);
    expect(result.value).toBe(true);
    expect(mock.getOracle()).toBe("ST2NEWORACLE");
  });

  it("tracks contract token balance", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.recordRevenue(BigInt(1), BigInt(3000), "USD", {});
    mock.recordRevenue(BigInt(2), BigInt(7000), "STX", {});
    expect(mock.getTokenBalance(mock.getContractAddress())).toBe(BigInt(10000));
  });

  it("returns correct total recorded", () => {
    mock.caller = "ST1ADMIN";
    mock.initializeOracle("ST1ORACLE");
    mock.caller = "ST1ORACLE";
    mock.recordRevenue(BigInt(1), BigInt(1000), "USD", {});
    mock.recordRevenue(BigInt(2), BigInt(2000), "USD", {});
    expect(mock.getTotalRecorded()).toBe(BigInt(3000));
  });
});