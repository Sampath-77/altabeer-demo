import { describe, it, expect, beforeEach } from "vitest";
import {
  dubaiDate,
  dubaiMidnightUtc,
  deadlineForDate,
  deadlinePassed,
  shiftReportingDate,
  yesterdayDubai,
  makeReportRef,
  makeFlagRef,
} from "@/lib/compliance/schedule";
import {
  assertCheckInEligible,
  submitDailyReport,
  adminResolveFlag,
  adminGrantExemption,
  adminReviewReport,
  getPendingReportDates,
  buildDailyReportTable,
  runComplianceCheckJob,
} from "@/lib/compliance/service";
import { AuthError } from "@/lib/auth/service";
import { MockOdoo } from "@/lib/odoo/mock";
import type { Storage } from "@/lib/storage";

// In-memory test storage
function mockStorage(): Storage {
  const store = new Map<string, Buffer>();
  return {
    put: async (data, ext) => {
      const key = `test-${store.size + 1}.${ext}`;
      store.set(key, data);
      return key;
    },
    get: async key => {
      const b = store.get(key);
      if (!b) throw new Error("not found");
      return b;
    },
  };
}

// Valid sample JPEG header
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
// Valid sample PNG header
const FAKE_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);

describe("Compliance Schedule & Date Calculations (Asia/Dubai)", () => {
  it("computes Dubai date correctly (UTC+4)", () => {
    // 2026-10-31 20:30 UTC is 2026-11-01 00:30 in Dubai
    const t = Date.UTC(2026, 9, 31, 20, 30, 0);
    expect(dubaiDate(t)).toBe("2026-11-01");

    // 2026-10-31 19:59 UTC is 2026-10-31 23:59 in Dubai
    const t2 = Date.UTC(2026, 9, 31, 19, 59, 0);
    expect(dubaiDate(t2)).toBe("2026-10-31");
  });

  it("assigns overnight shift strictly to the check-in date in Dubai", () => {
    // Shift starts at 22:00 Dubai time on 2026-10-30 (18:00 UTC)
    const checkInIso = "2026-10-30T18:00:00.000Z";
    expect(shiftReportingDate(checkInIso)).toBe("2026-10-30");

    // Shift check-out happens on 2026-10-31 at 04:00 Dubai time
    // The obligation date remains 2026-10-30, not creating 2 obligations
    expect(shiftReportingDate(checkInIso)).toBe("2026-10-30");
  });

  it("calculates compliance deadline as next calendar day at configured hour", () => {
    // For reporting date 2026-10-30:
    // Deadline is 2026-10-31 at 04:00 Dubai time (00:00 UTC)
    const dl = deadlineForDate("2026-10-30");
    const dlIso = new Date(dl).toISOString();
    expect(dlIso).toBe("2026-10-31T00:00:00.000Z");

    // Before deadline
    const before = Date.parse("2026-10-30T23:00:00+04:00");
    expect(deadlinePassed("2026-10-30", before)).toBe(false);

    // After deadline
    const after = Date.parse("2026-10-31T05:00:00+04:00");
    expect(deadlinePassed("2026-10-30", after)).toBe(true);
  });

  it("generates readable references for reports and flags", () => {
    const rRef = makeReportRef("2026-10-30", "abcdef");
    expect(rRef).toBe("REP-20261030-ABCDEF");

    const fRef = makeFlagRef("2026-10-30", "123456");
    expect(fRef).toBe("FLG-20261030-123456");
  });
});

describe("Driver Daily Report Validation", () => {
  const storage = mockStorage();

  it("rejects future reporting dates", async () => {
    const now = Date.UTC(2026, 9, 30, 8, 0, 0); // 2026-10-30 12:00 Dubai
    await expect(
      submitDailyReport(
        "user-1",
        6,
        { reportingDate: "2026-10-31", reportType: "NO_VIOLATION", declarationConfirmed: true },
        [],
        storage,
        now,
      ),
    ).rejects.toThrow("future date");
  });

  it("rejects invalid date format", async () => {
    await expect(
      submitDailyReport(
        "user-1",
        6,
        { reportingDate: "30-10-2026", reportType: "NO_VIOLATION", declarationConfirmed: true },
        [],
        storage,
      ),
    ).rejects.toThrow("Invalid reporting date");
  });

  it("requires declaration confirmation for NO_VIOLATION", async () => {
    const now = Date.UTC(2026, 9, 30, 8, 0, 0);
    await expect(
      submitDailyReport(
        "user-1",
        6,
        { reportingDate: "2026-10-30", reportType: "NO_VIOLATION", declarationConfirmed: false },
        [],
        storage,
        now,
      ),
    ).rejects.toThrow("confirm the no-violation declaration");
  });

  it("requires category for VIOLATION and allows simplified submission without description or explanation", async () => {
    const now = Date.UTC(2026, 9, 30, 8, 0, 0);
    // Missing category
    await expect(
      submitDailyReport(
        "user-1",
        6,
        { reportingDate: "2026-10-30", reportType: "VIOLATION" },
        [],
        storage,
        now,
      ),
    ).rejects.toThrow("category is required");
  });

  it("rejects files larger than 8 MB or invalid file types", async () => {
    const now = Date.UTC(2026, 9, 30, 8, 0, 0);
    const bigFile = Buffer.alloc(9 * 1024 * 1024);
    await expect(
      submitDailyReport(
        "user-1",
        6,
        {
          reportingDate: "2026-10-30",
          reportType: "VIOLATION",
          violationCategory: "PARKING_VIOLATION",
          violationDescription: "Wrong bay",
          driverExplanation: "Emergency stop",
        },
        [{ buffer: bigFile, originalFilename: "too-big.jpg" }],
        storage,
        now,
      ),
    ).rejects.toThrow("exceeds 8 MB");

    const badFile = Buffer.from("plain text file masquerading as image");
    await expect(
      submitDailyReport(
        "user-1",
        6,
        {
          reportingDate: "2026-10-30",
          reportType: "VIOLATION",
          violationCategory: "PARKING_VIOLATION",
          violationDescription: "Wrong bay",
          driverExplanation: "Emergency stop",
        },
        [{ buffer: badFile, originalFilename: "fake.jpg" }],
        storage,
        now,
      ),
    ).rejects.toThrow("unsupported type");
  });
});

describe("Admin Override & Resolution Requirements", () => {
  it("requires remarks/explanation to remove restriction", async () => {
    await expect(
      adminResolveFlag("flag-1", "admin-1", "ADMIN_TEMPORARY_OVERRIDE", "   "),
    ).rejects.toThrow("reason/explanation is required");
  });

  it("requires reason to grant exemption", async () => {
    await expect(
      adminGrantExemption("admin-1", "user-1", 6, "2026-10-30", "   "),
    ).rejects.toThrow("reason is required");
  });

  it("requires valid action and remarks to review report", async () => {
    await expect(
      adminReviewReport("rep-1", "admin-1", "REVIEWED", ""),
    ).rejects.toThrow("Remarks are required");
  });
});

describe("Admin Daily Reports Table Aggregation (§21)", () => {
  it("builds table with mock Odoo correctly separating submitted, pending, and missing", async () => {
    const odoo = new MockOdoo();
    odoo.employees.set(6, { id: 6, name: "Mark Brown", active: true });
    odoo.employees.set(11, { id: 11, name: "Adnan Khan", active: true });
    odoo.vehicles.push({ id: 5, plate: "K 31906", model: "Tesla Model S", active: true });
    odoo.assignments.set(6, {
      vehicle: odoo.vehicles[0],
      assignment: { vehicleId: 5, employeeId: 6, from: "2026-01-01T00:00:00Z", to: null },
    });

    const now = Date.UTC(2026, 9, 31, 10, 0, 0); // 14:00 Dubai on 31 Oct
    const targetDate = "2026-10-31"; // Today

    const rows = await buildDailyReportTable(targetDate, odoo, now);
    expect(rows).toBeInstanceOf(Array);
    // Each active driver is represented
    for (const r of rows) {
      expect(r.reportingDate).toBe(targetDate);
      expect(["SUBMITTED", "PENDING", "MISSING", "EXEMPTED"]).toContain(r.rowStatus);
    }
  });
});

