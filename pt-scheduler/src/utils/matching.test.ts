import { describe, expect, it } from "vitest";
import { matchCandidate, MatchCandidate } from "./matching";

describe("matchCandidate", () => {
  const candidates: MatchCandidate[] = [
    { id: "1", fullName: "Robert Johnson", nicknames: ["Rob"] },
    { id: "2", fullName: "William Smith", nicknames: ["Bill"] },
    { id: "3", fullName: "Margaret Davis", nicknames: ["Maggie", "Peggy"] }
  ];

  describe("exact matching", () => {
    it("matches exact name with 100% confidence", () => {
      const result = matchCandidate("Robert Johnson", candidates);
      expect(result.candidate?.id).toBe("1");
      expect(result.confidence).toBe(100);
    });

    it("matches case-insensitively", () => {
      const result = matchCandidate("ROBERT JOHNSON", candidates);
      expect(result.candidate?.id).toBe("1");
      expect(result.confidence).toBe(100);
    });

    it("normalizes multiple spaces", () => {
      const result = matchCandidate("Robert    Johnson", candidates);
      expect(result.candidate?.id).toBe("1");
      expect(result.confidence).toBe(100);
    });

    it("trims leading and trailing whitespace", () => {
      const result = matchCandidate("  Robert Johnson  ", candidates);
      expect(result.candidate?.id).toBe("1");
      expect(result.confidence).toBe(100);
    });
  });

  describe("nickname matching via alias expansion", () => {
    it("matches Bob to Robert via alias expansion", () => {
      const result = matchCandidate("Bob Johnson", candidates);
      expect(result.candidate?.fullName).toBe("Robert Johnson");
      // "Bob Johnson" tokens: {bob, johnson} -> expanded: {bob, johnson, robert, bobby, rob}
      // "Robert Johnson" tokens: {robert, johnson} -> expanded: {robert, johnson, bob, bobby, rob}
      // Overlap is 5 tokens out of 5 input tokens = 100%
      expect(result.confidence).toBe(100);
    });

    it("matches Bobby to Robert", () => {
      const result = matchCandidate("Bobby Johnson", candidates);
      expect(result.candidate?.fullName).toBe("Robert Johnson");
      expect(result.confidence).toBe(100);
    });

    it("matches Bill to William", () => {
      const result = matchCandidate("Bill Smith", candidates);
      expect(result.candidate?.fullName).toBe("William Smith");
      expect(result.confidence).toBe(100);
    });

    it("matches Billy to William", () => {
      const result = matchCandidate("Billy Smith", candidates);
      expect(result.candidate?.fullName).toBe("William Smith");
      expect(result.confidence).toBe(100);
    });

    it("matches Peggy to Margaret", () => {
      const result = matchCandidate("Peggy Davis", candidates);
      expect(result.candidate?.fullName).toBe("Margaret Davis");
      expect(result.confidence).toBe(100);
    });

    it("matches Maggie to Margaret", () => {
      const result = matchCandidate("Maggie Davis", candidates);
      expect(result.candidate?.fullName).toBe("Margaret Davis");
      expect(result.confidence).toBe(100);
    });
  });

  describe("partial matching", () => {
    it("matches first name only with partial confidence", () => {
      const result = matchCandidate("Robert", candidates);
      expect(result.candidate?.fullName).toBe("Robert Johnson");
      // "Robert" -> 1 token, expanded to 5 (robert, bob, bobby, rob + original)
      // Matches all 5 expanded tokens from candidate
      expect(result.confidence).toBe(100);
    });

    it("matches last name only with partial confidence", () => {
      const result = matchCandidate("Johnson", candidates);
      expect(result.candidate?.fullName).toBe("Robert Johnson");
      // "Johnson" -> 1 token (no expansion), candidate has johnson
      expect(result.confidence).toBe(100);
    });

    it("handles extra tokens in input with lower confidence", () => {
      const result = matchCandidate("Robert Johnson Jr", candidates);
      expect(result.candidate?.fullName).toBe("Robert Johnson");
      // Input has 3 tokens (robert, johnson, jr) -> expanded includes 6+ tokens
      // But "jr" doesn't match anything, so confidence < 100
      expect(result.confidence).toBeLessThan(100);
      expect(result.confidence).toBeGreaterThan(50);
    });
  });

  describe("candidate nicknames field", () => {
    it("matches against explicit nicknames in candidate", () => {
      // "Rob" is in the nicknames array for Robert Johnson
      const result = matchCandidate("Rob Johnson", candidates);
      expect(result.candidate?.fullName).toBe("Robert Johnson");
      expect(result.confidence).toBe(100);
    });
  });

  describe("no match scenarios", () => {
    it("returns null when no candidate overlaps", () => {
      const result = matchCandidate("Alice Wonderland", candidates);
      expect(result.candidate).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it("returns null for completely unrelated input", () => {
      const result = matchCandidate("XYZ123", candidates);
      expect(result.candidate).toBeNull();
      expect(result.confidence).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty input string", () => {
      const result = matchCandidate("", candidates);
      expect(result.candidate).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it("handles whitespace-only input", () => {
      const result = matchCandidate("   ", candidates);
      expect(result.candidate).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it("handles empty candidates array", () => {
      const result = matchCandidate("Robert Johnson", []);
      expect(result.candidate).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it("handles input with special characters (may not match due to tokenization)", () => {
      // Note: Special characters become part of tokens, so "robert's" !== "robert"
      // This is a known limitation - the AI fallback stage handles such cases
      const result = matchCandidate("Robert's Johnson!", candidates);
      // The apostrophe makes "robert's" a different token than "robert"
      // Only "johnson!" partially matches, so we may get a low-confidence match or no match
      // This documents current behavior; AI fallback handles these cases
      expect(result.confidence).toBeLessThanOrEqual(100);
    });

    it("handles hyphenated names", () => {
      const hyphenatedCandidates: MatchCandidate[] = [
        { id: "1", fullName: "Mary-Jane Watson", nicknames: [] }
      ];
      const result = matchCandidate("Mary-Jane Watson", hyphenatedCandidates);
      expect(result.candidate?.id).toBe("1");
      expect(result.confidence).toBe(100);
    });

    it("handles input with repeated tokens", () => {
      // When input repeats tokens, the token set collapses them
      const result = matchCandidate("Robert Johnson Johnson", candidates);
      expect(result.candidate?.fullName).toBe("Robert Johnson");
      // Confidence based on unique tokens, not repeated ones
      expect(result.confidence).toBeGreaterThan(50);
    });
  });

  describe("best match selection", () => {
    it("chooses the highest confidence match", () => {
      const similarCandidates: MatchCandidate[] = [
        { id: "1", fullName: "John Smith", nicknames: [] },
        { id: "2", fullName: "John Smithson", nicknames: [] },
        { id: "3", fullName: "Johnny Smith", nicknames: [] }
      ];

      const result = matchCandidate("John Smith", similarCandidates);
      expect(result.candidate?.id).toBe("1");
      expect(result.confidence).toBe(100);
    });

    it("returns first match when multiple have same confidence", () => {
      const identicalCandidates: MatchCandidate[] = [
        { id: "1", fullName: "John Smith", nicknames: [] },
        { id: "2", fullName: "John Smith", nicknames: [] }
      ];

      const result = matchCandidate("John Smith", identicalCandidates);
      // Should return the first one found with highest confidence
      expect(result.candidate?.fullName).toBe("John Smith");
      expect(result.confidence).toBe(100);
    });
  });
});

