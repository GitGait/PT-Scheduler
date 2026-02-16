import Fuse from "fuse.js";
import { fetchWithTimeout } from "../api/request";

// ---------------------------------------------------------------------------
// Nickname mapping for alias expansion
// ---------------------------------------------------------------------------

const nicknameMap: Record<string, string[]> = {
  robert: ["bob", "bobby", "rob"],
  william: ["bill", "billy", "will"],
  richard: ["rick", "ricky", "dick"],
  margaret: ["maggie", "peggy"],
  elizabeth: ["liz", "lizzy", "beth", "betty"],
  jennifer: ["jen", "jenny"],
  michael: ["mike", "mikey"],
  james: ["jim", "jimmy"],
  joseph: ["joe", "joey"],
  thomas: ["tom", "tommy"],
  christopher: ["chris"],
  daniel: ["dan", "danny"],
  matthew: ["matt"],
  anthony: ["tony"],
  patricia: ["pat", "patty"],
  katherine: ["kate", "kathy", "katie"],
  deborah: ["deb", "debbie"],
  barbara: ["barb", "barbie"],
  susan: ["sue", "susie"],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  id: string;
  fullName: string;
  nicknames: string[];
}

export type MatchTier = "auto" | "confirm" | "manual";

export interface MatchResult {
  candidate: MatchCandidate | null;
  confidence: number;
  alternatives: { candidate: MatchCandidate; confidence: number }[];
  tier: MatchTier;
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalize(value).split(" "));
}

function expandAliases(tokens: Set<string>): Set<string> {
  const expanded = new Set(tokens);
  for (const [formal, nicknames] of Object.entries(nicknameMap)) {
    if (tokens.has(formal)) {
      for (const n of nicknames) expanded.add(n);
    }
    if (nicknames.some((n) => tokens.has(n))) {
      expanded.add(formal);
      for (const n of nicknames) expanded.add(n);
    }
  }
  return expanded;
}

function getTier(confidence: number): MatchTier {
  if (confidence >= 90) return "auto";
  if (confidence >= 70) return "confirm";
  return "manual";
}

// ---------------------------------------------------------------------------
// Stage 1: Exact + Nickname Token Matching
// ---------------------------------------------------------------------------

export function matchCandidate(
  rawName: string,
  candidates: MatchCandidate[]
): { candidate: MatchCandidate | null; confidence: number } {
  const inputTokens = expandAliases(tokenSet(rawName));
  let best: { candidate: MatchCandidate | null; confidence: number } = {
    candidate: null,
    confidence: 0,
  };

  for (const candidate of candidates) {
    const nameTokens = expandAliases(tokenSet(candidate.fullName));
    for (const nickname of candidate.nicknames) {
      for (const token of tokenSet(nickname)) {
        nameTokens.add(token);
      }
    }

    const overlap = [...inputTokens].filter((token) => nameTokens.has(token))
      .length;
    const confidence = Math.round(
      (overlap / Math.max(inputTokens.size, 1)) * 100
    );

    if (confidence > best.confidence) {
      best = { candidate, confidence };
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Stage 2: Fuzzy Matching with Fuse.js
// ---------------------------------------------------------------------------

function fuzzyMatch(
  rawName: string,
  candidates: MatchCandidate[]
): { candidate: MatchCandidate | null; confidence: number; all: { candidate: MatchCandidate; confidence: number }[] } {
  if (candidates.length === 0) {
    return { candidate: null, confidence: 0, all: [] };
  }

  const fuse = new Fuse(candidates, {
    keys: [
      { name: "fullName", weight: 0.7 },
      { name: "nicknames", weight: 0.3 },
    ],
    threshold: 0.4,
    includeScore: true,
  });

  const results = fuse.search(rawName);

  if (results.length === 0) {
    return { candidate: null, confidence: 0, all: [] };
  }

  const all = results.map((r) => ({
    candidate: r.item,
    confidence: Math.round((1 - (r.score ?? 0)) * 100),
  }));

  return {
    candidate: all[0].candidate,
    confidence: all[0].confidence,
    all,
  };
}

// ---------------------------------------------------------------------------
// Stage 3: AI Fallback (calls /api/match-patient)
// ---------------------------------------------------------------------------

interface AIMatchResponse {
  matchedName: string | null;
  confidence: number;
}

async function aiMatch(
  rawName: string,
  candidates: MatchCandidate[]
): Promise<{ candidate: MatchCandidate | null; confidence: number }> {
  try {
    const candidateNames = candidates.map((c) => c.fullName);

    const response = await fetchWithTimeout("/api/match-patient", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ocrName: rawName, candidateNames }),
    });

    if (!response.ok) {
      return { candidate: null, confidence: 0 };
    }

    const data: AIMatchResponse = await response.json();

    if (!data.matchedName) {
      return { candidate: null, confidence: data.confidence };
    }

    // Find the candidate that matches the AI response
    const matched = candidates.find(
      (c) => c.fullName.toLowerCase() === data.matchedName!.toLowerCase()
    );

    return {
      candidate: matched ?? null,
      confidence: data.confidence,
    };
  } catch {
    // AI fallback failed - return no match
    return { candidate: null, confidence: 0 };
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point: 3-Stage Matching
// ---------------------------------------------------------------------------

export interface MatchPatientOptions {
  /** Skip AI fallback (useful for testing or offline mode) */
  skipAI?: boolean;
}

export async function matchPatient(
  rawName: string,
  candidates: MatchCandidate[],
  options: MatchPatientOptions = {}
): Promise<MatchResult> {
  if (candidates.length === 0) {
    return {
      candidate: null,
      confidence: 0,
      alternatives: [],
      tier: "manual",
    };
  }

  // Stage 1: Exact + Nickname matching
  const stage1 = matchCandidate(rawName, candidates);

  if (stage1.confidence >= 90) {
    // High confidence - auto tier
    const alternatives = candidates
      .filter((c) => c.id !== stage1.candidate?.id)
      .slice(0, 3)
      .map((c) => ({ candidate: c, confidence: matchCandidate(c.fullName, [c]).confidence }));

    return {
      candidate: stage1.candidate,
      confidence: stage1.confidence,
      alternatives,
      tier: "auto",
    };
  }

  // Stage 2: Fuzzy matching with Fuse.js
  const stage2 = fuzzyMatch(rawName, candidates);

  // Use the better result from stage 1 or 2
  let bestConfidence = Math.max(stage1.confidence, stage2.confidence);
  let bestCandidate = stage1.confidence >= stage2.confidence
    ? stage1.candidate
    : stage2.candidate;

  if (bestConfidence >= 70) {
    // Collect alternatives from fuzzy results
    const alternatives = stage2.all
      .filter((r) => r.candidate.id !== bestCandidate?.id)
      .slice(0, 3);

    return {
      candidate: bestCandidate,
      confidence: bestConfidence,
      alternatives,
      tier: getTier(bestConfidence),
    };
  }

  // Stage 3: AI fallback (if enabled)
  if (!options.skipAI) {
    const stage3 = await aiMatch(rawName, candidates);

    if (stage3.confidence > bestConfidence) {
      bestConfidence = stage3.confidence;
      bestCandidate = stage3.candidate;
    }
  }

  // Collect alternatives from fuzzy results
  const alternatives = stage2.all
    .filter((r) => r.candidate.id !== bestCandidate?.id)
    .slice(0, 3);

  return {
    candidate: bestCandidate,
    confidence: bestConfidence,
    alternatives,
    tier: getTier(bestConfidence),
  };
}
