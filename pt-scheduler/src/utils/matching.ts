const nicknameMap: Record<string, string[]> = {
  robert: ["bob", "bobby", "rob"],
  william: ["bill", "billy", "will"],
  richard: ["rick", "ricky", "dick"],
  margaret: ["maggie", "peggy"]
};

export interface MatchCandidate {
  id: string;
  fullName: string;
  nicknames: string[];
}

export interface MatchResult {
  candidate: MatchCandidate | null;
  confidence: number;
}

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

export function matchCandidate(
  rawName: string,
  candidates: MatchCandidate[]
): MatchResult {
  const inputTokens = expandAliases(tokenSet(rawName));
  let best: MatchResult = { candidate: null, confidence: 0 };

  for (const candidate of candidates) {
    const nameTokens = expandAliases(tokenSet(candidate.fullName));
    for (const nickname of candidate.nicknames) {
      for (const token of tokenSet(nickname)) {
        nameTokens.add(token);
      }
    }

    const overlap = [...inputTokens].filter((token) => nameTokens.has(token))
      .length;
    const confidence = Math.round((overlap / Math.max(inputTokens.size, 1)) * 100);

    if (confidence > best.confidence) {
      best = { candidate, confidence };
    }
  }

  return best;
}

